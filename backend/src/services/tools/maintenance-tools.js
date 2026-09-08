/**
 * 维护 / 告警 / 指标域工具注册(maintenance.* alert.* metrics.query backup.trigger …)。
 * 由 agent-tools.js 拆分 —— 工具注册链与 helper 逐字节搬运。
 */
import { addComposeBackup, addPerformanceBaseline, getSetting, setSetting } from '../../lib/db.js';
import { configureAlert, deleteAlert, listAlerts, queryContainerMetrics } from '../agent-metrics.js';
import { readCompose } from '../compose-runner.js';
import { createJob } from '../cron-scheduler.js';
import { getActivityDocker } from '../docker-hosts.js';
import { getProjectUpdates } from '../image-updater.js';
import { checkImageUpdates } from '../maintenance.js';
import { getNotificationConfig, sendNotification } from '../notifications.js';
import { findProject, scanProjects } from '../scanner.js';
import { readContainerStat } from '../stats.js';

function sumSpace(reclaimed) {
  return Object.values(reclaimed || {}).reduce((total, value) => total + (Number(value) || 0), 0);
}

function readAlertRules() {
  try {
    const parsed = JSON.parse(getSetting('agent.alert_rules', '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** 读取指定 Compose 文件当前内容(兼容 mounted / workspace)。 */
async function currentComposeContent(project, fileIndex = 0) {
  const index = Number(fileIndex) || 0;
  if (project.mounted) return (await readCompose(project, index)).content;
  const { readWorkspaceCompose } = await import('../compose-workspace.js');
  return (await readWorkspaceCompose(project, index)).content;
}

export function registerMaintenanceTools(agent) {
  agent
    .registerTool('alert.create', {
      description: '创建容器资源告警规则(CPU/内存/重启次数阈值)',
      category: 'maintenance',
      requiredPermission: 'managed',
      confirmationRequired: true,
      requiresProject: true,
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: '项目 ID' },
          service: { type: 'string', description: '服务名' },
          metric: { type: 'string', enum: ['cpu', 'memory', 'restart_count'], description: '指标' },
          threshold: { type: 'number', description: '阈值' },
          action: { type: 'string', enum: ['notify', 'auto_restart', 'scale'], description: '触发动作' },
        },
        required: ['projectId', 'service', 'metric', 'threshold', 'action'],
      },
      execute: async (params) => {
        const rules = readAlertRules();
        const rule = {
          id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          projectId: params.projectId,
          service: String(params.service || ''),
          metric: params.metric,
          threshold: Number(params.threshold),
          action: params.action,
          createdAt: new Date().toISOString(),
        };
        rules.push(rule);
        setSetting('agent.alert_rules', JSON.stringify(rules));
        return { created: true, rule, note: '规则已保存;阈值判定由告警引擎按需执行' };
      },
      undo: async (params, result) => {
        const rules = readAlertRules().filter((item) => item.id !== result?.rule?.id);
        setSetting('agent.alert_rules', JSON.stringify(rules));
        return { ok: true, removed: result?.rule?.id || null };
      },
    })
    .registerTool('maintenance.clean', {
      description: '清理未使用的镜像/卷/网络/构建缓存',
      category: 'maintenance',
      requiredPermission: 'admin',
      confirmationRequired: true,
      requiresProject: false,
      parameters: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['images', 'volumes', 'networks', 'all'], description: '清理范围' },
        },
        required: ['scope'],
      },
      execute: async (params) => {
        const docker = getActivityDocker();
        const scope = params.scope;
        const reclaimed = {};
        if (scope === 'images' || scope === 'all') {
          const res = await docker.pruneImages({ filters: { dangling: ['false'] } });
          reclaimed.images = sumSpace(res?.SpaceReclaimed ? { SpaceReclaimed: res.SpaceReclaimed } : {});
        }
        if (scope === 'volumes' || scope === 'all') {
          const res = await docker.pruneVolumes();
          reclaimed.volumes = sumSpace({ SpaceReclaimed: res?.SpaceReclaimed });
        }
        if (scope === 'networks' || scope === 'all') {
          const res = await docker.pruneNetworks();
          reclaimed.networks = sumSpace({ SpaceReclaimed: res?.SpaceReclaimed });
        }
        if (scope === 'all') {
          const res = await docker.pruneBuilds();
          reclaimed.buildCache = sumSpace({ SpaceReclaimed: res?.SpaceReclaimed });
        }
        const total = Object.values(reclaimed).reduce((acc, value) => acc + (Number(value) || 0), 0);
        return { scope, reclaimedBytes: total, reclaimedMB: Math.round((total / 1024 / 1024) * 10) / 10, reclaimed };
      },
    })
    .registerTool('maintenance.update', {
      description: '检查纳管项目镜像是否有远程更新',
      category: 'maintenance',
      requiredPermission: 'readonly',
      confirmationRequired: false,
      requiresProject: false,
      parameters: {
        type: 'object',
        properties: { projectId: { type: 'string', description: '项目 ID(可选,缺省全局检查)' } },
      },
      execute: async (params) => {
        if (params.projectId) {
          const project = await findProject(params.projectId);
          if (!project) throw Object.assign(new Error('项目不存在或当前不可见'), { statusCode: 404 });
          return getProjectUpdates(project, { force: true });
        }
        return { results: await checkImageUpdates() };
      },
    })
    .registerTool('metrics.query', {
      description: '查询容器资源指标(CPU/内存/网络/磁盘)及历史趋势',
      category: 'diagnostic',
      requiredPermission: 'readonly',
      confirmationRequired: false,
      requiresProject: false,
      parameters: {
        type: 'object',
        properties: {
          container: { type: 'string', description: '容器名称或 ID' },
          metric: { type: 'string', enum: ['cpu', 'memory', 'network', 'disk'], description: '指标类型(默认 cpu)' },
          period: { type: 'string', description: '历史时间段(如 5m/1h/24h,默认 5m)' },
        },
        required: ['container'],
      },
      execute: async (params) => queryContainerMetrics(params.container, params.metric || 'cpu', params.period || '5m'),
    })
    .registerTool('alert.configure', {
      description: '配置容器资源告警规则(超过阈值触发通知或自动操作)',
      category: 'maintenance',
      requiredPermission: 'admin',
      confirmationRequired: true,
      requiresProject: false,
      parameters: {
        type: 'object',
        properties: {
          container: { type: 'string', description: '容器名称或 ID' },
          metric: { type: 'string', enum: ['cpu', 'memory', 'network', 'disk'], description: '监控指标' },
          threshold: { type: 'number', description: '阈值(CPU/内存为百分比,网络/磁盘为 MB/s 或 MB)' },
          duration: { type: 'string', description: '持续时间(如 5m/10m,默认 5m)' },
          action: { type: 'string', enum: ['notify', 'restart', 'scale'], description: '触发动作(默认 notify)' },
        },
        required: ['container', 'metric', 'threshold'],
      },
      execute: async (params) => configureAlert({
        container: params.container,
        metric: params.metric,
        threshold: Number(params.threshold),
        duration: params.duration || '5m',
        action: params.action || 'notify',
      }),
    })
    .registerTool('alert.list', {
      description: '列出已配置的告警规则',
      category: 'maintenance',
      requiredPermission: 'readonly',
      confirmationRequired: false,
      requiresProject: false,
      parameters: {
        type: 'object',
        properties: {
          container: { type: 'string', description: '容器名称或 ID(可选,用于过滤)' },
        },
      },
      execute: async (params) => listAlerts(params.container),
    })
    .registerTool('alert.delete', {
      description: '删除告警规则',
      category: 'maintenance',
      requiredPermission: 'admin',
      confirmationRequired: true,
      requiresProject: false,
      parameters: {
        type: 'object',
        properties: {
          ruleId: { type: 'string', description: '规则 ID' },
        },
        required: ['ruleId'],
      },
      execute: async (params) => deleteAlert(params.ruleId),
    })
    .registerTool('backup.trigger', {
      description: '手动为项目 Compose 配置创建备份快照',
      category: 'maintenance',
      requiredPermission: 'editable',
      confirmationRequired: false,
      requiresProject: true,
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: '项目 ID' },
          fileIndex: { type: 'number', description: 'Compose 文件索引(默认 0)' },
        },
        required: ['projectId'],
      },
      execute: async (params, context) => {
        const fileIndex = Number(params.fileIndex) || 0;
        const content = await currentComposeContent(context.project, fileIndex);
        const filePath = context.project.composeFiles[fileIndex];
        const backupId = addComposeBackup(context.project.id, filePath, content, 'agent:backup.trigger');
        return { ok: true, backupId, filePath };
      },
    })
    .registerTool('notification.test', {
      description: '发送测试通知以验证通知渠道配置',
      category: 'maintenance',
      requiredPermission: 'managed',
      confirmationRequired: false,
      requiresProject: false,
      parameters: {
        type: 'object',
        properties: { message: { type: 'string', description: '自定义测试消息(可选)' } },
      },
      execute: async (params) => {
        const config = getNotificationConfig(false);
        if (!config.enabled) throw new Error('通知功能尚未启用');
        const message = String(params.message || '这是一条来自 AI Agent 的测试通知');
        await sendNotification('ComposeOps Agent 测试通知', message, config);
        return { ok: true, type: config.type };
      },
    })
    .registerTool('cron.create', {
      description: '创建定时任务(如镜像检查/数据库备份/清理)',
      category: 'maintenance',
      requiredPermission: 'managed',
      confirmationRequired: true,
      requiresProject: false,
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '任务名称' },
          type: { type: 'string', enum: ['db-backup', 'prune-safe', 'prune-all', 'images-check', 'pull-images'], description: '任务类型' },
          cron: { type: 'string', description: '5 段 cron 表达式(分 时 日 月 周)' },
        },
        required: ['name', 'type', 'cron'],
      },
      execute: async (params) => createJob({ name: params.name, type: params.type, cron: params.cron }),
    })
    .registerTool('performance.baseline', {
      description: '记录当前纳管项目资源使用基线(CPU/内存/IO)',
      category: 'maintenance',
      requiredPermission: 'managed',
      confirmationRequired: false,
      requiresProject: false,
      parameters: {
        type: 'object',
        properties: { label: { type: 'string', description: '基线标签(可选)' } },
      },
      execute: async (params) => {
        const projects = (await scanProjects()).filter((project) => project.managed);
        const snapshot = [];
        for (const project of projects) {
          for (const container of project.containers.filter((item) => item.state === 'running')) {
            try {
              snapshot.push({ project: project.projectName, container: container.name, ...(await readContainerStat(container.id)) });
            } catch {
              snapshot.push({ project: project.projectName, container: container.name, error: '无法读取统计' });
            }
          }
        }
        const baseline = { label: String(params.label || ''), capturedAt: new Date().toISOString(), snapshot };
        const id = addPerformanceBaseline(baseline.label, baseline);
        return { id, ...baseline };
      },
    });
  return agent;
}
