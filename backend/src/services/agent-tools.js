import * as YAML from 'yaml';
import { addComposeBackup, addPerformanceBaseline, getComposeBackup, listComposeBackups, getSetting, setSetting } from '../lib/db.js';
import { getActivityDocker } from './docker-hosts.js';
import { findProject, findProjectContainer, scanProjects } from './scanner.js';
import { prepareProjectAction } from './project-action-runner.js';
import { readCompose, saveCompose, spawnComposeCommand } from './compose-runner.js';
import { runWorkspaceComposeArgs } from './compose-workspace.js';
import { validateComposeSemantics, previewComposeChange } from './compose-validator.js';
import { checkImageUpdates } from './maintenance.js';
import { getProjectUpdates } from './image-updater.js';
import { readContainerStat } from './stats.js';
import { callOpenAI, getAiConfig } from './ai.js';
import { assertEnvAccess, readProjectEnv, saveProjectEnv, applyProjectEnv } from './project-env.js';
import { getNotificationConfig, sendNotification } from './notifications.js';
import { createJob } from './cron-scheduler.js';
import { queryContainerMetrics, configureAlert, listAlerts, deleteAlert } from './agent-metrics.js';
import { execReadonly, readContainerLogs } from '../lib/docker-exec.js';

/** 只读探测与日志读取:统一自 ../lib/docker-exec.js(白名单含 curl/wget 移除说明)。 */

/**
 * 动态风险评估:根据项目上下文提升工具风险等级
 * @param {string} toolName - 工具名称
 * @param {object} params - 工具参数
 * @param {object} context - 执行上下文(包含 project)
 * @returns {string} 动态评估后的风险等级
 */
export function assessRisk(toolName, params, context) {
  const RISK_LEVELS = {
    'compose.up': 'high',
    'compose.stop': 'high',
    'compose.restart': 'medium',
    'compose.pull': 'low',
    'config.edit': 'high',
    'config.rollback': 'high',
    'environment.set': 'high',
    'volume.mount': 'high',
    'maintenance.clean': 'critical',
    'compose.exec': 'high',
    'compose.scale': 'medium',
    'cron.create': 'medium',
  };

  const baseRisk = RISK_LEVELS[toolName] || 'low';

  // 生产项目提升风险等级
  const project = context?.project;
  if (project && (project.tags?.includes('production') || project.projectName?.match(/prod|production/i))) {
    if (baseRisk === 'medium') return 'high';
    if (baseRisk === 'high') return 'critical';
  }

  return baseRisk;
}

function collectOutput() {
  let text = '';
  return {
    push: (stream, chunk) => { text += chunk; },
    text: () => text.slice(-20000),
  };
}

function sumSpace(reclaimed) {
  return Object.values(reclaimed || {}).reduce((total, value) => total + (Number(value) || 0), 0);
}

/** 把用户填写的值尽力转成布尔/数字,保持环境变量等字符串语义不变。 */
function coerceValue(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed !== '' && !Number.isNaN(Number(trimmed))) return Number(trimmed);
  return value;
}

const SECRET_KEY = /(SECRET|TOKEN|PASSWORD|PASSWD|\bPASS\b|(?:API|PRIVATE|ACCESS|SECRET|AUTH|SIGNING)[_-]?KEY)/i;

/** 在 mounted / workspace 两种可编辑模式下执行任意 docker compose 参数。 */
async function runComposeArgs(project, args, onOutput = () => {}) {
  const output = collectOutput();
  if (project.mounted) {
    const code = await new Promise((resolve, reject) => {
      const child = spawnComposeCommand(project, args);
      child.stdout.on('data', (chunk) => { onOutput('stdout', chunk.toString('utf8')); output.push('stdout', chunk); });
      child.stderr.on('data', (chunk) => { onOutput('stderr', chunk.toString('utf8')); output.push('stderr', chunk); });
      child.on('error', reject);
      child.on('close', (code) => resolve(code ?? 1));
    });
    return { mode: 'compose', exitCode: code, output: output.text() };
  }
  const code = await runWorkspaceComposeArgs(project, args, (stream, chunk) => {
    onOutput(stream, chunk.toString('utf8'));
    output.push(stream, Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  });
  return { mode: 'workspace', exitCode: code, output: output.text() };
}

/** 读取指定 Compose 文件当前内容(兼容 mounted / workspace)。 */
async function currentComposeContent(project, fileIndex = 0) {
  const index = Number(fileIndex) || 0;
  if (project.mounted) return (await readCompose(project, index)).content;
  const { readWorkspaceCompose } = await import('./compose-workspace.js');
  return (await readWorkspaceCompose(project, index)).content;
}

/** 保存 Compose 内容(兼容 mounted / workspace)。 */
async function saveProjectCompose(project, fileIndex, content, reason) {
  const index = Number(fileIndex) || 0;
  if (project.mounted) return saveCompose(project, index, content, reason);
  const { saveWorkspaceCompose } = await import('./compose-workspace.js');
  return saveWorkspaceCompose(project, index, content, reason);
}

/** 行级 diff:返回 { added, removed, unified }。 */
function diffTexts(before, after) {
  const beforeLines = String(before || '').split('\n');
  const afterLines = String(after || '').split('\n');
  const beforeSet = new Set(beforeLines);
  const afterSet = new Set(afterLines);
  const added = afterLines.filter((line) => !beforeSet.has(line));
  const removed = beforeLines.filter((line) => !afterSet.has(line));
  return { added, removed, unified: null, addedCount: added.length, removedCount: removed.length };
}

export function registerAgentTools(agent) {
  // ---- Compose 生命周期 ----
  const lifecycleAction = (action) => async (params, context) => {
    const project = context.project;
    const prepared = await prepareProjectAction(project, action);
    const output = collectOutput();
    const exitCode = await prepared.run((stream, chunk) => output.push(stream, chunk));
    return { mode: prepared.mode, action, exitCode, output: output.text() };
  };

  agent
    .registerTool('compose.up', {
      description: '启动 Compose 项目,可指定服务(仅整个项目级启动)',
      category: 'compose',
      requiredPermission: 'managed',
      confirmationRequired: true,
      requiresProject: true,
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: '项目 ID' },
          services: { type: 'array', items: { type: 'string' }, description: '指定服务(可选)' },
        },
        required: ['projectId'],
      },
      execute: lifecycleAction('up'),
    })
    .registerTool('compose.stop', {
      description: '停止 Compose 项目或指定服务',
      category: 'compose',
      requiredPermission: 'managed',
      confirmationRequired: true,
      requiresProject: true,
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: '项目 ID' },
          services: { type: 'array', items: { type: 'string' }, description: '指定服务(可选)' },
        },
        required: ['projectId'],
      },
      execute: lifecycleAction('stop'),
    })
    .registerTool('compose.restart', {
      description: '重启 Compose 项目或指定服务',
      category: 'compose',
      requiredPermission: 'managed',
      confirmationRequired: true,
      requiresProject: true,
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: '项目 ID' },
          services: { type: 'array', items: { type: 'string' }, description: '指定服务(可选)' },
        },
        required: ['projectId'],
      },
      execute: lifecycleAction('restart'),
    })
    .registerTool('compose.pull', {
      description: '拉取项目镜像(需可编辑的 Compose 目录能力)',
      category: 'compose',
      requiredPermission: 'editable',
      confirmationRequired: false,
      requiresProject: true,
      parameters: {
        type: 'object',
        properties: { projectId: { type: 'string', description: '项目 ID' } },
        required: ['projectId'],
      },
      execute: lifecycleAction('pull'),
    })
    .registerTool('compose.logs', {
      description: '读取项目容器最近日志(只读),可按服务过滤与关键词检索',
      category: 'diagnostic',
      requiredPermission: 'managed',
      confirmationRequired: false,
      requiresProject: true,
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: '项目 ID' },
          containerId: { type: 'string', description: '指定容器(可选)' },
          services: { type: 'array', items: { type: 'string' }, description: '指定服务(可选)' },
          tail: { type: 'number', description: '最后 N 行(默认 100)' },
          grep: { type: 'string', description: '搜索关键词(可选)' },
        },
        required: ['projectId'],
      },
      execute: async (params, context) => {
        const tail = Math.min(Math.max(Number(params.tail) || 100, 20), 2000);
        const docker = getActivityDocker();
        let targets = context.project.containers || [];
        if (params.containerId) {
          const match = await findProjectContainer(params.projectId, params.containerId);
          targets = match?.container ? [match.container] : [];
        } else if (Array.isArray(params.services) && params.services.length) {
          const wanted = params.services.map((s) => String(s).toLowerCase());
          targets = targets.filter((c) => wanted.some((s) => c.name.toLowerCase().includes(s)));
        }
        const lines = [];
        for (const item of targets) {
          const logs = await readContainerLogs(docker.getContainer(item.id), tail);
          const needle = params.grep ? String(params.grep) : '';
          const filtered = needle
            ? logs.split('\n').filter((line) => line.includes(needle))
            : logs.split('\n');
          for (const line of filtered) lines.push(`[${item.name}] ${line}`);
        }
        return { containers: targets.map((item) => item.name), logs: lines.slice(-tail).join('\n') };
      },
    })
    .registerTool('compose.ps', {
      description: '列出项目或全部纳管项目的容器状态(只读)',
      category: 'compose',
      requiredPermission: 'managed',
      confirmationRequired: false,
      requiresProject: false,
      parameters: {
        type: 'object',
        properties: { projectId: { type: 'string', description: '项目 ID(可选,缺省返回全部纳管项目)' } },
      },
      execute: async (params, _context) => {
        const projects = await scanProjects();
        const managed = projects.filter((project) => project.managed);
        const scoped = params.projectId ? managed.filter((project) => project.id === params.projectId) : managed;
        return scoped.map((project) => ({
          projectId: project.id,
          projectName: project.projectName,
          status: project.status,
          containers: project.containers.map((c) => ({
            name: c.name,
            state: c.state,
            statusText: c.statusText,
            image: c.image,
          })),
        }));
      },
    });

  // ---- 配置操作 ----
  agent
    .registerTool('config.preview', {
      description: '预览 Compose 配置变更对运行容器的影响(diff/重启范围)',
      category: 'config',
      requiredPermission: 'editable',
      confirmationRequired: false,
      requiresProject: true,
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: '项目 ID' },
          content: { type: 'string', description: '新的 Compose 内容(可选,缺省读取当前文件)' },
          fileIndex: { type: 'number', description: 'Compose 文件索引(默认 0)' },
        },
        required: ['projectId'],
      },
      execute: async (params, context) => {
        const content = typeof params.content === 'string' && params.content
          ? params.content
          : (await readCompose(context.project, Number(params.fileIndex) || 0)).content;
        const preview = previewComposeChange(content, context.project);
        return { preview, contentLength: content.length };
      },
    })
    .registerTool('config.validate', {
      description: '校验 Compose 配置语法与语义(依赖/端口/镜像)',
      category: 'config',
      requiredPermission: 'editable',
      confirmationRequired: false,
      requiresProject: true,
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: '项目 ID' },
          content: { type: 'string', description: 'Compose 内容(可选,缺省读取当前文件)' },
          fileIndex: { type: 'number', description: 'Compose 文件索引(默认 0)' },
        },
        required: ['projectId'],
      },
      execute: async (params, context) => {
        const content = typeof params.content === 'string' && params.content
          ? params.content
          : (await readCompose(context.project, Number(params.fileIndex) || 0)).content;
        const issues = validateComposeSemantics(content);
        return { issues, errorCount: issues.filter((issue) => issue.level === 'error').length };
      },
    })
    .registerTool('config.edit', {
      description: '按 YAML 点路径编辑 Compose 配置(set/unset/append)',
      category: 'config',
      requiredPermission: 'editable',
      confirmationRequired: true,
      requiresProject: true,
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: '项目 ID' },
          fileIndex: { type: 'number', description: 'Compose 文件索引(默认 0)' },
          path: { type: 'string', description: 'YAML 点路径,如 services.web.environment.DEBUG' },
          value: { type: 'string', description: '新值' },
          action: { type: 'string', enum: ['set', 'unset', 'append'], description: '操作类型' },
        },
        required: ['projectId', 'path', 'action'],
      },
      execute: async (params, context) => {
        const fileIndex = Number(params.fileIndex) || 0;
        const current = await readCompose(context.project, fileIndex);
        const doc = YAML.parseDocument(current.content);
        const keys = String(params.path).split('.').map((key) => key.trim()).filter(Boolean);
        if (!keys.length) throw new Error('path 不能为空');
        if (params.action === 'unset') {
          doc.deleteIn(keys);
        } else if (params.action === 'append') {
          const existing = doc.getIn(keys);
          const next = existing == null
            ? [coerceValue(params.value)]
            : Array.isArray(existing)
              ? [...existing, coerceValue(params.value)]
              : [existing, coerceValue(params.value)];
          doc.setIn(keys, next);
        } else {
          doc.setIn(keys, coerceValue(params.value));
        }
        await saveCompose(context.project, fileIndex, doc.toString(), `agent:config.edit:${params.path}`);
        return { ok: true, path: params.path, action: params.action, fileIndex, previous: current.content };
      },
      undo: async (params, _result, context) => {
        if (!_result?.previous) throw new Error('缺少回滚内容');
        await saveProjectCompose(context.project, Number(params.fileIndex) || 0, _result.previous, 'agent:config.edit:undo');
        return { ok: true, rolledBack: params.path };
      },
    });

  // ---- 诊断 ----
  agent
    .registerTool('diagnostic.probe', {
      description: '在容器内执行只读探测命令(env/ps/netstat/curl/cat/tail 等)',
      category: 'diagnostic',
      requiredPermission: 'managed',
      confirmationRequired: false,
      requiresProject: true,
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: '项目 ID' },
          containerId: { type: 'string', description: '容器 ID' },
          command: { type: 'string', description: '只读命令' },
        },
        required: ['projectId', 'containerId', 'command'],
      },
      execute: async (params, context) => {
        if (!context.container) throw new Error('容器不属于当前项目');
        const container = getActivityDocker().getContainer(context.container.id);
        return execReadonly(container, params.command);
      },
    })
    .registerTool('diagnostic.analyze', {
      description: '结合容器日志调用 LLM 分析故障根因并给出修复建议',
      category: 'diagnostic',
      requiredPermission: 'managed',
      confirmationRequired: false,
      requiresProject: true,
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: '项目 ID' },
          containerId: { type: 'string', description: '容器 ID(可选)' },
          logs: { type: 'string', description: '日志内容(可选,缺省自动读取)' },
        },
        required: ['projectId'],
      },
      execute: async (params, context) => {
        const cfg = getAiConfig();
        if (!cfg.apiKey) throw new Error('未配置 AI API Key,无法执行诊断分析');
        let logs = params.logs ? String(params.logs) : '';
        if (!logs && context.container) {
          logs = await readContainerLogs(getActivityDocker().getContainer(context.container.id), 200);
        }
        const prompt = `请分析以下容器日志,给出问题根因、证据与可执行修复步骤。\n\n${logs.slice(-12000)}`;
        const analysis = await callOpenAI({
          ...cfg,
          messages: [
            { role: 'system', content: '你是 Docker 容器排障专家,回答中文、结构化,先结论后步骤。' },
            { role: 'user', content: prompt },
          ],
          stream: false,
        });
        return { analysis, logLength: logs.length, suggestions: [] };
      },
    });

  // ---- 告警与维护 ----
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
      requiredPermission: 'managed',
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
      requiredPermission: 'managed',
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
    });

  // ---- 指标与告警 ----
  agent
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
      requiredPermission: 'managed',
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
      requiredPermission: 'managed',
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
    });

  // ---- Sprint 2:高级编排 / 配置 / 环境 / 维护 ----
  agent
    .registerTool('compose.scale', {
      description: '调整服务副本数(需可编辑的 Compose 目录能力)',
      category: 'compose',
      requiredPermission: 'editable',
      confirmationRequired: true,
      requiresProject: true,
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: '项目 ID' },
          service: { type: 'string', description: '服务名' },
          replicas: { type: 'number', description: '目标副本数' },
        },
        required: ['projectId', 'service', 'replicas'],
      },
      execute: async (params, context) => {
        const replicas = Math.max(0, Math.min(Math.floor(Number(params.replicas)), 100));
        const service = String(params.service || '').trim();
        if (!service) throw new Error('服务名不能为空');
        const result = await runComposeArgs(context.project, ['up', '-d', '--scale', `${service}=${replicas}`]);
        return { service, replicas, ...result };
      },
    })
    .registerTool('compose.exec', {
      description: '在项目容器内执行命令(会写入容器,需确认)',
      category: 'compose',
      requiredPermission: 'managed',
      confirmationRequired: true,
      requiresProject: true,
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: '项目 ID' },
          containerId: { type: 'string', description: '容器 ID' },
          command: { type: 'string', description: '要执行的命令' },
        },
        required: ['projectId', 'containerId', 'command'],
      },
      execute: async (params, context) => {
        if (!context.container) throw new Error('容器不属于当前项目');
        const command = String(params.command || '').trim();
        if (!command) throw new Error('命令不能为空');

        // 检查 ENABLE_SHELL 全局开关(与 Web Shell 一致的安全边界)
        const enableShell = process.env.ENABLE_SHELL === '1';
        if (!enableShell) {
          throw Object.assign(
            new Error('Shell 执行未启用,设置 ENABLE_SHELL=1 后重启'),
            { statusCode: 403 }
          );
        }

        const docker = getActivityDocker();
        const container = docker.getContainer(context.container.id);
        const started = Date.now();
        const exec = await container.exec({ AttachStdout: true, AttachStderr: true, Cmd: ['/bin/sh', '-c', command] });
        const stream = await exec.start({ Tty: false });
        const chunks = [];
        for await (const chunk of stream) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const inspect = await exec.inspect().catch(() => null);
        return {
          stdout: Buffer.concat(chunks).toString('utf8').slice(0, 20000),
          exitCode: inspect?.ExitCode ?? null,
          durationMs: Date.now() - started,
        };
      },
    })
    .registerTool('config.rollback', {
      description: '把 Compose 配置回滚到历史备份版本',
      category: 'config',
      requiredPermission: 'editable',
      confirmationRequired: true,
      requiresProject: true,
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: '项目 ID' },
          backupId: { type: 'number', description: '备份 ID(可选,缺省回滚到最近一份)' },
        },
        required: ['projectId'],
      },
      execute: async (params, context) => {
        const backups = listComposeBackups(context.project.id);
        if (!backups.length) throw new Error('该项目没有可用备份');
        const backupId = params.backupId ? Number(params.backupId) : backups[0].id;
        const backup = getComposeBackup(context.project.id, backupId);
        if (!backup) throw Object.assign(new Error('备份不存在'), { statusCode: 404 });
        const fileIndex = context.project.composeFiles.indexOf(backup.filePath);
        if (fileIndex < 0) throw new Error('备份对应的 Compose 文件已变更');
        await saveProjectCompose(context.project, fileIndex, backup.content, `agent:config.rollback:${backupId}`);
        return { ok: true, backupId, filePath: backup.filePath, createdAt: backup.createdAt };
      },
    })
    .registerTool('config.diff', {
      description: '对比当前 Compose 配置与某个备份版本的差异',
      category: 'config',
      requiredPermission: 'editable',
      confirmationRequired: false,
      requiresProject: true,
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: '项目 ID' },
          backupId: { type: 'number', description: '备份 ID' },
          fileIndex: { type: 'number', description: 'Compose 文件索引(默认 0)' },
        },
        required: ['projectId', 'backupId'],
      },
      execute: async (params, context) => {
        const backup = getComposeBackup(context.project.id, Number(params.backupId));
        if (!backup) throw Object.assign(new Error('备份不存在'), { statusCode: 404 });
        const fileIndex = context.project.composeFiles.indexOf(backup.filePath);
        const current = await currentComposeContent(context.project, fileIndex >= 0 ? fileIndex : Number(params.fileIndex) || 0);
        return { backupId: backup.id, createdAt: backup.createdAt, ...diffTexts(current, backup.content) };
      },
    })
    .registerTool('environment.get', {
      description: '读取项目 .env(敏感值自动脱敏)',
      category: 'config',
      requiredPermission: 'editable',
      confirmationRequired: false,
      requiresProject: true,
      parameters: {
        type: 'object',
        properties: { projectId: { type: 'string', description: '项目 ID' } },
        required: ['projectId'],
      },
      execute: async (_params, context) => {
        assertEnvAccess(context.project);
        const payload = await readProjectEnv(context.project);
        const entries = (payload.entries || []).map((entry) => ({
          key: entry.key,
          value: SECRET_KEY.test(entry.key || '') ? '••••••' : entry.value,
          secret: SECRET_KEY.test(entry.key || ''),
        }));
        return { path: payload.path, exists: payload.exists, entries };
      },
    })
    .registerTool('environment.set', {
      description: '写入单个环境变量并可选重启项目生效',
      category: 'config',
      requiredPermission: 'editable',
      confirmationRequired: true,
      requiresProject: true,
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: '项目 ID' },
          key: { type: 'string', description: '变量名' },
          value: { type: 'string', description: '变量值' },
          restart: { type: 'boolean', description: '是否保存后重启项目(默认 true)' },
        },
        required: ['projectId', 'key', 'value'],
      },
      execute: async (params, context) => {
        assertEnvAccess(context.project);
        const key = String(params.key || '').trim();
        if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error('环境变量名不合法');
        const payload = await readProjectEnv(context.project);
        const entries = (payload.entries || []).filter((entry) => entry.key !== key);
        entries.push({ key, value: String(params.value) });
        const saved = await saveProjectEnv(context.project, { entries });
        let applied = null;
        if (params.restart !== false) {
          const output = collectOutput();
          const code = await applyProjectEnv(context.project, {
            onOutput: (stream, chunk) => output.push(stream, Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))),
          });
          applied = { exitCode: code, output: output.text() };
        }
        return { ok: true, key, backup: saved.backup, applied, previousRaw: payload.raw };
      },
      undo: async (_params, result, context) => {
        if (result?.previousRaw == null) throw new Error('缺少回滚内容');
        await saveProjectEnv(context.project, { raw: result.previousRaw });
        return { ok: true, restored: true };
      },
    })
    .registerTool('network.inspect', {
      description: '查看 Docker 网络列表或指定网络详情(只读)',
      category: 'diagnostic',
      requiredPermission: 'managed',
      confirmationRequired: false,
      requiresProject: false,
      parameters: {
        type: 'object',
        properties: {
          network: { type: 'string', description: '网络名称或 ID(可选,缺省返回列表)' },
        },
      },
      execute: async (params) => {
        const docker = getActivityDocker();
        if (params.network) {
          const inspect = await docker.getNetwork(String(params.network)).inspect();
          const containers = Object.entries(inspect.Containers || {}).map(([id, value]) => ({ id, name: value.Name, ipv4: value.IPv4Address, ipv6: value.IPv6Address }));
          return { id: inspect.Id, name: inspect.Name, driver: inspect.Driver, scope: inspect.Scope, containers };
        }
        const networks = await docker.listNetworks();
        return { networks: networks.map((n) => ({ id: n.Id, name: n.Name, driver: n.Driver, scope: n.Scope })) };
      },
    })
    .registerTool('security.audit', {
      description: '审计容器安全风险(特权模式/root 运行/端口暴露/重启/OOM/健康)',
      category: 'diagnostic',
      requiredPermission: 'managed',
      confirmationRequired: false,
      requiresProject: false,
      parameters: {
        type: 'object',
        properties: { projectId: { type: 'string', description: '项目 ID(可选,缺省审计全部纳管项目)' } },
      },
      execute: async (params) => {
        const docker = getActivityDocker();
        const projects = (await scanProjects()).filter((project) => project.managed);
        const scoped = params.projectId ? projects.filter((project) => project.id === params.projectId) : projects;
        const findings = [];
        for (const project of scoped) {
          for (const item of project.containers) {
            if (item.state !== 'running') continue;
            try {
              const inspect = await docker.getContainer(item.id).inspect();
              const hostCfg = inspect.HostConfig || {};
              const cfg = inspect.Config || {};
              findings.push({
                project: project.projectName,
                container: item.name,
                privileged: !!hostCfg.Privileged,
                runningAsRoot: !cfg.User || cfg.User === 'root' || cfg.User === '0',
                exposedPorts: (item.ports || []).map((port) => `${port.public}:${port.private}/${port.type}`),
                restartCount: Number(inspect.RestartCount) || 0,
                oomKilled: !!(inspect.State && inspect.State.OOMKilled),
                health: item.health,
              });
            } catch {
              findings.push({ project: project.projectName, container: item.name, error: '无法审计' });
            }
          }
        }
        const risky = findings.filter((finding) => finding.privileged || finding.runningAsRoot || finding.oomKilled || finding.restartCount > 5);
        return { findings, riskyCount: risky.length, total: findings.length };
      },
    })
    .registerTool('volume.mount', {
      description: '给服务追加卷挂载(宿主目录/命名卷 → 容器路径)',
      category: 'config',
      requiredPermission: 'editable',
      confirmationRequired: true,
      requiresProject: true,
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: '项目 ID' },
          fileIndex: { type: 'number', description: 'Compose 文件索引(默认 0)' },
          service: { type: 'string', description: '服务名' },
          source: { type: 'string', description: '宿主目录或命名卷' },
          target: { type: 'string', description: '容器内路径' },
        },
        required: ['projectId', 'service', 'source', 'target'],
      },
      execute: async (params, context) => {
        const fileIndex = Number(params.fileIndex) || 0;
        const current = await currentComposeContent(context.project, fileIndex);
        const doc = YAML.parseDocument(current);
        const service = String(params.service || '').trim();
        const source = String(params.source || '').trim();
        const target = String(params.target || '').trim();
        if (!service || !source || !target) throw new Error('service/source/target 不能为空');
        if (!doc.hasIn(['services', service])) throw Object.assign(new Error(`服务 ${service} 不存在`), { statusCode: 404 });

        // 校验 source 路径安全性:必须位于项目目录内或已明确挂载的受控路径
        const { safeProjectMountPath } = await import('../services/mount-plan.js');
        const projectMount = safeProjectMountPath(context.project.workingDir);
        if (!projectMount) {
          throw Object.assign(
            new Error('项目工作目录不在安全挂载范围内'),
            { statusCode: 403 }
          );
        }
        // source 必须是绝对路径且在项目目录下(防止挂载任意宿主机路径)
        if (!source.startsWith('/')) {
          throw Object.assign(
            new Error('source 必须是绝对路径'),
            { statusCode: 400 }
          );
        }
        if (!source.startsWith(`${projectMount}/`)) {
          throw Object.assign(
            new Error(`source 必须位于项目目录 ${projectMount} 内`),
            { statusCode: 403 }
          );
        }

        const mount = `${source}:${target}`;
        const existing = doc.getIn(['services', service, 'volumes']);
        const list = existing == null ? [] : Array.isArray(existing) ? [...existing] : [existing];
        const normalized = list
          .map((item) => (typeof item === 'string' ? item : String(item)))
          .filter((item) => {
            const [, existingTarget] = item.split(':').length >= 2 ? [null, item.split(':').slice(-1)[0]] : [null, null];
            return existingTarget !== target;
          });
        normalized.push(mount);
        doc.setIn(['services', service, 'volumes'], normalized);
        await saveProjectCompose(context.project, fileIndex, doc.toString(), `agent:volume.mount:${service}`);
        return { ok: true, service, mount, previous: current };
      },
      undo: async (params, result, context) => {
        if (result?.previous == null) throw new Error('缺少回滚内容');
        await saveProjectCompose(context.project, Number(params.fileIndex) || 0, result.previous, 'agent:volume.mount:undo');
        return { ok: true, rolledBack: true };
      },
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

function readAlertRules() {
  try {
    const parsed = JSON.parse(getSetting('agent.alert_rules', '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
