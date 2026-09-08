/**
 * Agent 规划与上下文/权限门模块。
 *
 * 从 agent.js 拆分 —— 只含"纯逻辑,不依赖 OperationsAgent 实例状态"的 helper:
 *  - LLM 规划输出解析(parsePlanJson)
 *  - 确定性回退规划(defaultPlan,无 AI Key 时的关键词 → 工具映射)
 *  - 工具执行上下文解析(resolveToolContext: projectId/containerId → project/container)
 *  - 四档权限门(assertPermission)与轻量参数校验(validateParams)
 *
 * 被 OperationsAgent(engine.js)与 agent.test.js 复用。
 */

import { findProject, findProjectContainer } from '../scanner.js';

/** 解析 LLM 输出中的 JSON(兼容 markdown 代码块与前后杂质文本)。 */
export function parsePlanJson(text) {
  const source = String(text || '');
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(source);
  const candidate = fenced ? fenced[1] : source;
  try {
    return JSON.parse(candidate.trim());
  } catch {}
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(candidate.slice(first, last + 1));
    } catch {}
  }
  return null;
}

/** 确定性回退规划:基于关键词把意图映射到工具,保证无 AI Key 时也可用。 */
export function defaultPlan(agent, message, _context = {}) {
  const text = String(message || '');
  const rules = [
    [/重启|restart/, 'compose.restart'],
    [/启动|start|\bup\b/, 'compose.up'],
    [/停止|stop/, 'compose.stop'],
    [/拉取|pull/, 'compose.pull'],
    [/日志|log/, 'compose.logs'],
    [/状态|列表|ps|容器/, 'compose.ps'],
    [/修改配置|编辑配置|配置.*(改|编辑)|环境变量|edit/, 'config.edit'],
    [/校验|validate/, 'config.validate'],
    [/预览|diff|preview/, 'config.preview'],
    [/诊断|分析|排查|analyze|为什么|原因/, 'diagnostic.analyze'],
    [/告警|阈值|alert/, 'alert.create'],
    [/清理|clean|prune/, 'maintenance.clean'],
    [/更新镜像|升级|update/, 'maintenance.update'],
    [/资源|内存|cpu|指标|metrics/, 'metrics.query'],
  ];
  const steps = [];
  for (const [pattern, tool] of rules) {
    if (pattern.test(text)) {
      const meta = agent.getTool(tool);
      steps.push({ tool, params: {}, confirmationRequired: !!meta?.confirmationRequired });
      if (steps.length >= 4) break; // 单条需求最多规划 4 步,避免过度发散
    }
  }
  if (!steps.length) {
    const meta = agent.getTool('compose.ps');
    steps.push({ tool: 'compose.ps', params: {}, confirmationRequired: !!meta?.confirmationRequired });
  }
  return steps;
}

/** 解析工具执行所需的项目/容器上下文。 */
export async function resolveToolContext(params = {}) {
  const projectId = params?.projectId;
  if (!projectId) return { project: null, projectId: null, container: null };
  const project = await findProject(projectId);
  if (!project) throw Object.assign(new Error('项目不存在或当前不可见'), { statusCode: 404 });
  let container = null;
  if (params.containerId) {
    const match = await findProjectContainer(projectId, params.containerId);
    container = match?.container || null;
  }
  return { project, projectId, container };
}

/** 权限门:managed / editable / readonly / admin 四档。 */
export async function assertPermission(tool, context) {
  const { project } = context || {};

  // 检查项目必需性
  if (tool.requiresProject && !project) {
    throw Object.assign(new Error('该工具需要指定 projectId'), { statusCode: 400 });
  }

  // admin 工具不受项目权限约束(仅用于全局维护操作)
  if (tool.requiredPermission === 'admin') return;

  // readonly 工具在无项目时允许执行(全局只读查询)
  if (!project && tool.requiredPermission === 'readonly') return;

  // 其他工具需要项目且必须已纳管
  if (project && !project.managed) {
    throw Object.assign(new Error('项目尚未加入管理,无法执行此工具'), { statusCode: 403 });
  }

  // editable 工具额外检查 Compose 目录权限
  if (tool.requiredPermission === 'editable' && project && !project.editable) {
    throw Object.assign(new Error('项目未启用可编辑的 Compose 目录能力'), { statusCode: 403 });
  }

  // 默认拒绝:工具声明了需要的权限但上下文不满足
  if (tool.requiredPermission && !['admin', 'readonly'].includes(tool.requiredPermission)) {
    if (!project) {
      throw Object.assign(new Error('工具需要项目上下文'), { statusCode: 403 });
    }
  }
}

/** 轻量 JSON Schema 校验:仅检查必填字段与数组类型。 */
export function validateParams(schema = {}, params = {}) {
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const key of required) {
    if (params[key] === undefined || params[key] === null || params[key] === '') {
      throw Object.assign(new Error(`缺少必填参数 ${key}`), { statusCode: 400 });
    }
  }
  for (const [key, def] of Object.entries(schema.properties || {})) {
    if (def?.type === 'array' && params[key] !== undefined && !Array.isArray(params[key])) {
      throw Object.assign(new Error(`参数 ${key} 必须是数组`), { statusCode: 400 });
    }
  }
}
