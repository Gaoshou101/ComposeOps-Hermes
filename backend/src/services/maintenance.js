import docker from './docker.js';
import { scanProjects } from './scanner.js';
import { sendNotification } from './notifications.js';
import { setSetting } from '../lib/db.js';
import db, { pruneAgentPlans, pruneOperationHistory } from '../lib/db.js';

function sum(items, key) {
  return (items || []).reduce((total, item) => total + (Number(item?.[key]) || 0), 0);
}

export async function getDockerUsage() {
  const data = await docker.df();
  const imagesTotal = sum(data.Images, 'Size');
  const imagesReclaimable = sum((data.Images || []).filter((item) => Number(item.Containers) <= 0), 'Size');
  const containersReclaimable = sum((data.Containers || []).filter((item) => item.State !== 'running'), 'SizeRw');
  const buildCacheTotal = sum(data.BuildCache, 'Size');
  const buildCacheReclaimable = sum((data.BuildCache || []).filter((item) => !item.InUse), 'Size');
  const unusedVolumes = (data.Volumes || []).filter((item) => Number(item.UsageData?.RefCount) <= 0);
  const volumesReclaimable = unusedVolumes
    .reduce((total, item) => total + (Number(item.UsageData?.Size) || 0), 0);
  return {
    images: { count: data.Images?.length || 0, total: imagesTotal, reclaimable: imagesReclaimable },
    containers: { count: data.Containers?.length || 0, reclaimable: containersReclaimable },
    buildCache: { count: data.BuildCache?.length || 0, total: buildCacheTotal, reclaimable: buildCacheReclaimable },
    volumes: { count: unusedVolumes.length, reclaimable: volumesReclaimable },
    total: imagesTotal + buildCacheTotal,
    reclaimable: imagesReclaimable + containersReclaimable + buildCacheReclaimable + volumesReclaimable,
  };
}

async function imageId(image) {
  try { return (await docker.getImage(image).inspect()).Id; } catch { return null; }
}

export async function checkImageUpdates(onProgress = () => {}) {
  const projects = await scanProjects();
  const images = [...new Set(projects
    .filter((project) => project.managed)
    .flatMap((project) => project.containers.map((item) => item.image))
    .filter(Boolean))];
  const results = [];
  for (const image of images) {
    const before = await imageId(image);
    onProgress(`拉取 ${image}`);
    try {
      const stream = await docker.pull(image);
      await new Promise((resolve, reject) => {
        docker.modem.followProgress(stream, (error) => error ? reject(error) : resolve());
      });
      const after = await imageId(image);
      results.push({ image, status: before && after && before !== after ? 'updated' : 'current', before, after });
    } catch (error) {
      results.push({ image, status: 'failed', error: error.message });
    }
  }
  const updated = results.filter((item) => item.status === 'updated');
  if (updated.length) {
    await sendNotification('ComposeOps：发现镜像更新', updated.map((item) => item.image).join('\n')).catch(() => {});
  }
  setSetting('updates.last_results', JSON.stringify(results));
  return results;
}

export async function pruneDocker({ images = true, buildCache = true, containers = false, volumes = false }) {
  const result = {};
  if (images) result.images = await docker.pruneImages({ filters: { dangling: ['false'] } });
  if (buildCache) result.buildCache = await docker.pruneBuilds();
  if (containers) result.containers = await docker.pruneContainers();
  if (volumes) result.volumes = await docker.pruneVolumes();
  return result;
}

/* ---------------------------------------------------------------------------
 * 数据维护:周期清理无上限增长只追加的历史表。
 * 与上述 Docker 清理同属 maintenance,故归置一处。
 * 定时任务用 setInterval.unref(),不阻塞进程退出。
 * ------------------------------------------------------------------------- */

const DATA_DEFAULTS = {
  agentPlansDays: 90,        // agent_plans(含 CASCADE agent_executions)保留天数
  operationHistoryDays: 30,  // operation_history 保留天数
  aiHistoryDays: 30,         // ai_history 保留天数
  composeBackupKeep: 5,      // 每个项目保留的最新备份份数(0 = 不清理)
  runIntervalMs: 6 * 60 * 60 * 1000, // 每 6 小时
};

/** 清理超过保留天数的 AI 对话历史。 */
export function pruneDataHistory({ aiHistoryDays, operationHistoryDays, agentPlansDays } = {}) {
  const clear = {
    aiHistoryDays,
    operationHistoryDays,
    agentPlansDays,
  };
  const days = clear.aiHistoryDays ?? DATA_DEFAULTS.aiHistoryDays;
  const safeDays = Math.max(1, Math.min(Math.floor(Number(days) || 30), 3650));
  const ai = db.prepare(
    "DELETE FROM ai_history WHERE julianday('now') - julianday(created_at) > ?"
  ).run(safeDays);

  const opDays = clear.operationHistoryDays ?? DATA_DEFAULTS.operationHistoryDays;
  const operations = pruneOperationHistory(opDays);

  const planDays = clear.agentPlansDays ?? DATA_DEFAULTS.agentPlansDays;
  const agent = pruneAgentPlans(planDays);

  return {
    aiHistoryDeleted: ai.changes,
    operationHistoryDeleted: operations.changes,
    agentPlansDeleted: agent.changes,
  };
}

/** 每个项目只保留最新 N 份 compose_backups。 */
export function pruneComposeBackups(keep = DATA_DEFAULTS.composeBackupKeep) {
  const safeKeep = Math.max(1, Math.min(Math.floor(Number(keep) || 5), 100));
  return db.prepare(`
    DELETE FROM compose_backups
    WHERE id NOT IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY id DESC) AS rn
        FROM compose_backups
      ) WHERE rn <= ?
    )
  `).run(safeKeep);
}

/** 执行全部数据清理,返回各表删除行数。 */
export function runDataMaintenance() {
  const history = pruneDataHistory();
  const backups = pruneComposeBackups();
  return {
    ...history,
    composeBackupsDeleted: backups.changes,
    at: new Date().toISOString(),
  };
}

let dataTimer = null;

/** 启动周期数据清理,返回 stop 函数。 interval 不阻塞进程退出。 */
export function startDataMaintenance(intervalMs = DATA_DEFAULTS.runIntervalMs) {
  if (dataTimer) return () => {};
  const interval = setInterval(() => {
    try {
      const result = runDataMaintenance();
      console.log(`[维护] 数据清理完成:${JSON.stringify(result)}`);
    } catch (error) {
      console.error('[维护] 数据清理失败:', error.message);
    }
  }, intervalMs);
  interval.unref();

  // 启动后延迟一分钟做首次清理,避免与其它启动任务争 IO。
  const firstRun = setTimeout(() => {
    try {
      const result = runDataMaintenance();
      console.log(`[维护] 首次清理完成:${JSON.stringify(result)}`);
    } catch (error) {
      console.error('[维护] 首次清理失败:', error.message);
    }
  }, 60 * 1000);
  firstRun.unref();

  dataTimer = interval;
  return () => {
    clearInterval(interval);
    clearTimeout(firstRun);
    dataTimer = null;
  };
}