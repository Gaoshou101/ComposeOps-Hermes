import { getAiConfig, callOpenAI } from './ai.js';
import {
  createAgentPlan,
  getAgentPlan,
  updateAgentPlan,
  recordAgentExecution,
  updateAgentExecution,
  listAgentPlans,
  listAgentExecutions,
} from '../lib/db.js';
import { registerAgentTools } from './agent-tools.js';
import { findProject, findProjectContainer } from './scanner.js';
import { PreconditionChecker, PostconditionValidator, TOOL_CATEGORIES, expandMacro, MACRO_TOOLS } from './agent-tool-categories.js';

/**
 * ComposeOps 自研轻量 Agent 编排引擎。
 * 三层职责:
 *  - Tool Registry:工具元数据 + 执行函数注册
 *  - Execution Engine:状态机 + 权限门 + 参数校验 + 审计落库
 *  - Thought Tracing:结构化思维链,供前端可视化
 *
 * 不引入 LangChain/n8n,直接复用现有 Docker/Compose/DB/权限服务。
 */

const PLAN_SYSTEM_PROMPT = `你是 ComposeOps 的运维规划 Agent。请根据用户需求,从给定的工具列表中规划执行步骤。

工具组织:
- 工具已按类别组织(lifecycle/config/diagnostic/maintenance/security/advanced),便于快速定位。
- 提供宏工具(macro.*)用于原子化多步操作:
  * macro.safe_restart: 安全重启(备份→停止→验证→启动→健康检查)
  * macro.deploy_with_backup: 带备份的配置部署
  * macro.scale_with_health_check: 带健康检查的扩缩容
  * macro.emergency_rollback: 紧急回滚(停止→配置回滚→重启→验证)

规则:
1. 只使用列表中声明的工具,不得虚构工具名。
2. 优先使用宏工具简化常见多步操作,减少失败风险。
3. 每个步骤给出 tool 与 params;params 只填写你从用户需求中能确定的字段,项目 ID 会由系统自动注入。
4. 高风险操作(启动/停止/重启/修改配置/清理资源)需要用户确认,系统会自动标记。
5. 输出必须是合法 JSON,不要输出 markdown 代码块以外的任何文字。

输出格式:
{"steps":[{"tool":"工具名","params":{}},{"tool":"工具名","params":{}}]}`;

/** 工具风险等级:低/中/高/极高,前端据此决定确认强度。 */
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

/** 多角色 Agent:不同角色限定不同 system prompt 与可调用工具。 */
export const AGENT_ROLES = {
  planner: { label: '运维规划师', description: '理解需求并制定执行计划', allowedTools: null },
  executor: { label: '执行者', description: '严格按计划逐步执行工具', allowedTools: null },
  validator: { label: '验证者', description: '只读验证执行结果', allowedTools: ['compose.ps', 'compose.logs', 'metrics.query', 'network.inspect', 'config.validate', 'config.preview'] },
  incident_responder: { label: '应急响应者', description: '快速响应并应急修复', allowedTools: ['compose.restart', 'compose.up', 'compose.stop', 'alert.create', 'diagnostic.probe', 'diagnostic.analyze', 'compose.logs'] },
};

export class OperationsAgent {
  constructor() {
    this.tools = new Map();
    this.executionHistory = [];
    this.currentContext = null;
    this.thoughts = [];
    registerAgentTools(this);
  }

  registerTool(name, config) {
    if (!name || typeof config?.execute !== 'function') {
      throw new Error(`工具 ${name} 缺少 execute 实现`);
    }
    this.tools.set(name, {
      requiredPermission: 'managed',
      confirmationRequired: false,
      category: 'maintenance',
      requiresProject: false,
      parameters: { type: 'object', properties: {} },
      ...config,
      risk: RISK_LEVELS[name] || config.risk || 'low',
      name,
    });
    return this;
  }

  listRoles() {
    return Object.entries(AGENT_ROLES).map(([name, meta]) => ({ name, ...meta }));
  }

  getTool(name) {
    return this.tools.get(name) || null;
  }

  /** 返回不含 execute 的元数据,用于前端提示与 LLM 规划。 */
  listTools() {
    const tools = [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      requiredPermission: tool.requiredPermission,
      confirmationRequired: tool.confirmationRequired,
      risk: tool.risk,
      category: tool.category,
    }));
    
    // 追加宏工具
    const macros = Object.values(MACRO_TOOLS).map((macro) => ({
      name: macro.name,
      description: macro.description,
      parameters: macro.parameters,
      requiredPermission: macro.requiredPermission,
      confirmationRequired: true, // 宏工具默认需要确认
      risk: macro.risk,
      category: macro.category,
      isMacro: true
    }));
    
    return [...tools, ...macros];
  }
  
  /** 返回工具分类信息 */
  listCategories() {
    return Object.entries(TOOL_CATEGORIES).map(([name, category]) => ({
      name,
      label: category.label,
      description: category.description,
      icon: category.icon,
      risk: category.risk,
      toolCount: category.tools.length
    }));
  }

  addThought(phase, content, metadata = {}) {
    const thought = { timestamp: Date.now(), phase, content, metadata };
    this.thoughts.push(thought);
    return thought;
  }

  /**
   * 规划入口:理解意图 → 选择工具 → 生成步骤。
   * @returns {{ steps: Array<{tool:string, params:object, confirmationRequired:boolean}>, confirmations: string[] }}
   */
  async plan(userMessage, context = {}) {
    this.thoughts = [];
    this.addThought('understanding', '正在理解用户意图…', { message: String(userMessage || '') });
    const role = context.role && AGENT_ROLES[context.role] ? context.role : 'planner';
    this.addThought('planning', `使用「${AGENT_ROLES[role].label}」角色规划`, { role });
    const steps = await this._planSteps(userMessage, { ...context, role });
    const boundSteps = this._bindContext(steps, context);
    const confirmations = boundSteps
      .filter((step) => this.getTool(step.tool)?.confirmationRequired)
      .map((step) => step.tool);
    this.addThought('planning', `已生成 ${boundSteps.length} 步执行计划`, {
      tools: boundSteps.map((step) => step.tool),
      role,
    });
    return { role, steps: boundSteps, confirmations: [...new Set(confirmations)] };
  }

  async _planSteps(userMessage, context) {
    const cfg = getAiConfig();
    if (!cfg.apiKey) {
      this.addThought('planning', '未配置 AI API Key,使用确定性规则规划', {});
      return defaultPlan(this, userMessage, context);
    }
    try {
      const role = context.role && AGENT_ROLES[context.role] ? context.role : 'planner';
      const roleMeta = AGENT_ROLES[role];
      const visibleTools = this.listTools()
        .filter((tool) => !roleMeta.allowedTools || roleMeta.allowedTools.includes(tool.name));
      const tools = visibleTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        confirmationRequired: tool.confirmationRequired,
      }));
      const text = await callOpenAI({
        ...cfg,
        messages: [
          { role: 'system', content: `${PLAN_SYSTEM_PROMPT}\n\n当前角色:${roleMeta.label}(${roleMeta.description})。` },
          {
            role: 'user',
            content: `可用工具:\n${JSON.stringify(tools)}\n\n用户需求:${String(userMessage || '')}`,
          },
        ],
        stream: false,
      });
      const parsed = parsePlanJson(text);
      if (parsed?.steps?.length) return parsed.steps;
      this.addThought('planning', 'AI 规划结果不可用,回退确定性规则', {});
      return defaultPlan(this, userMessage, context);
    } catch {
      this.addThought('planning', 'AI 规划调用失败,回退确定性规则', {});
      return defaultPlan(this, userMessage, context);
    }
  }

  /** 把请求上下文中的 projectId/containerId 注入到需要它们的工具步骤。 */
  _bindContext(steps, context) {
    const role = context.role && AGENT_ROLES[context.role] ? context.role : null;
    return steps
      .map((step) => {
      const tool = this.getTool(step.tool);
      const params = { ...(step.params || {}) };
      const properties = tool?.parameters?.properties || {};
      if (properties.projectId && !params.projectId && context.projectId) {
        params.projectId = context.projectId;
      }
      if (properties.containerId && !params.containerId && context.containerId) {
        params.containerId = context.containerId;
      }
      return { tool: step.tool, params, confirmationRequired: !!tool?.confirmationRequired, risk: tool?.risk || 'low' };
    })
      .filter((step) => {
        if (!role) return true;
        const meta = AGENT_ROLES[role];
        return !meta.allowedTools || meta.allowedTools.includes(step.tool);
      });
  }

  /** 执行单个工具(用于快速调用与 /agent/confirm)。 */
  async executeTool(toolName, params = {}, _context = {}) {
    // 宏工具展开
    if (toolName.startsWith('macro.')) {
      const expanded = expandMacro(toolName, params, _context);
      if (!expanded) throw Object.assign(new Error(`未知的宏工具:${toolName}`), { statusCode: 404 });
      this.addThought('planning', `宏工具 ${toolName} 展开为 ${expanded.steps.length} 步`, { steps: expanded.steps });
      // 递归执行宏的每一步
      const results = [];
      for (const step of expanded.steps) {
        const stepResult = await this.executeTool(step.tool, step.params, _context);
        results.push(stepResult);
        if (!stepResult.success) break; // 宏中任一步失败即停止
      }
      const allSuccess = results.every(r => r.success);
      return { success: allSuccess, isMacro: true, steps: results, durationMs: results.reduce((sum, r) => sum + (r.durationMs || 0), 0) };
    }

    const tool = this.getTool(toolName);
    if (!tool) throw Object.assign(new Error(`未注册的工具:${toolName}`), { statusCode: 404 });
    
    // 前置条件检查
    const precondition = await PreconditionChecker.check(toolName, params, _context);
    if (!precondition.allowed) {
      this.addThought('validating', `前置条件未满足:${precondition.reason}`, { tool: toolName });
      throw Object.assign(new Error(precondition.reason), { statusCode: 400 });
    }
    
    const resolved = await resolveToolContext(params);
    await assertPermission(tool, resolved);
    validateParams(tool.parameters, params);
    this.addThought('executing', `正在执行 ${toolName}`, { params });
    const started = Date.now();
    try {
      const result = await tool.execute(params, resolved);
      
      // 后置条件验证
      const postcondition = await PostconditionValidator.validate(toolName, params, result, _context);
      if (!postcondition.valid) {
        this.addThought('validating', `后置条件验证失败:${postcondition.reason}`, { tool: toolName });
        return { success: false, error: postcondition.reason, result, durationMs: Date.now() - started };
      }
      
      return { success: true, result, durationMs: Date.now() - started };
    } catch (error) {
      return { success: false, error: error.message, durationMs: Date.now() - started };
    }
  }

  /**
   * 执行多步工作流,逐步记录执行结果与思维链。
   * 任何一步失败即停止后续步骤(避免级联误操作),不自动回滚有副作用操作。
   */
  async executeWorkflow(planId, steps, _context = {}) {
    this.thoughts = [];
    const results = [];
    this.addThought('planning', '开始执行工作流', { steps: steps.length });
    for (const step of steps) {
      const toolName = step.tool;
      const params = step.params || {};

      // 强制确认检查:关键工具必须经过确认流程
      const tool = this.getTool(toolName);
      if (!tool) {
        results.push({ tool: toolName, status: 'not_found', error: '未注册的工具' });
        this.addThought('validating', `工具 ${toolName} 未注册`, {});
        break;
      }
      if (tool.confirmationRequired && !step.confirmed) {
        results.push({ tool: toolName, status: 'requires_confirmation', error: '该工具需要用户确认后才能执行' });
        this.addThought('validating', `${toolName} 需要确认`, {});
        updateAgentPlan(planId, { status: 'pending_confirmation', resultJson: { results }, executedAt: new Date().toISOString() });
        return { success: false, status: 'pending_confirmation', results, awaitingConfirmation: true };
      }

      // 前置条件检查
      const precondition = await PreconditionChecker.check(toolName, params, _context);
      if (!precondition.allowed) {
        results.push({ tool: toolName, status: 'precondition_failed', error: precondition.reason });
        this.addThought('validating', `${toolName} 前置条件未满足:${precondition.reason}`, {});
        break;
      }

      const execId = recordAgentExecution(planId, toolName, params, 'executing');
      this.addThought('executing', `执行 ${toolName}`, { execId, params });
      const started = Date.now();
      try {
        const resolved = await resolveToolContext(params);
        await assertPermission(tool, resolved);
        validateParams(tool.parameters, params);
        const result = await tool.execute(params, resolved);
        
        // 后置条件验证
        const postcondition = await PostconditionValidator.validate(toolName, params, result, _context);
        if (!postcondition.valid) {
          updateAgentExecution(execId, { status: 'postcondition_failed', error: postcondition.reason, result, durationMs: Date.now() - started });
          results.push({ tool: toolName, status: 'postcondition_failed', error: postcondition.reason, result, durationMs: Date.now() - started });
          this.addThought('validating', `${toolName} 后置条件验证失败:${postcondition.reason}`, { execId });
          break;
        }
        
        updateAgentExecution(execId, { status: 'success', result, durationMs: Date.now() - started });
        results.push({ tool: toolName, status: 'success', result, durationMs: Date.now() - started });
        this.addThought('validating', `${toolName} 执行成功`, { execId });
      } catch (error) {
        updateAgentExecution(execId, { status: 'failed', error: error.message, durationMs: Date.now() - started });
        results.push({ tool: toolName, status: 'failed', error: error.message, durationMs: Date.now() - started });
        this.addThought('validating', `${toolName} 执行失败:${error.message}`, { execId });
        break;
      }
    }
    const failed = results.some((item) => item.status === 'failed');
    const status = results.length === 0 ? 'failed' : failed ? 'failed' : 'completed';
    updateAgentPlan(planId, { status, resultJson: { results }, executedAt: new Date().toISOString() });
    this.addThought('done', failed ? '工作流执行失败' : '工作流执行完成', { results });
    return { success: !failed && results.length > 0, status, results };
  }

  /**
   * 带原子回滚的工作流:任一步失败时,按反序调用已执行工具的 undo。
   * 无 undo 实现的工具会被跳过,并在结果中标记需要人工介入。
   */
  async executeWorkflowWithRollback(planId, steps, context = {}) {
    const completed = [];
    this.thoughts = [];
    this.addThought('planning', '开始执行带回滚能力的工作流', { steps: steps.length });
    for (const step of steps) {
      const toolName = step.tool;
      const params = step.params || {};
      const execId = recordAgentExecution(planId, toolName, params, 'executing');
      const started = Date.now();
      try {
        const tool = this.getTool(toolName);
        if (!tool) throw Object.assign(new Error(`未注册的工具:${toolName}`), { statusCode: 404 });
        const resolved = await resolveToolContext(params);
        await assertPermission(tool, resolved);
        validateParams(tool.parameters, params);
        const result = await tool.execute(params, resolved);
        updateAgentExecution(execId, { status: 'success', result, durationMs: Date.now() - started });
        completed.push({ toolName, params, result });
        this.addThought('validating', `${toolName} 执行成功`, { execId });
      } catch (error) {
        updateAgentExecution(execId, { status: 'failed', error: error.message, durationMs: Date.now() - started });
        this.addThought('validating', `${toolName} 执行失败,触发回滚`, { execId });
        const rollback = await this._rollback(completed, context);
        const status = 'failed';
        updateAgentPlan(planId, {
          status,
          resultJson: { results: completed, error: error.message, rollback },
          executedAt: new Date().toISOString(),
        });
        return { success: false, status, error: error.message, rollback, completed };
      }
    }
    const status = 'completed';
    updateAgentPlan(planId, { status, resultJson: { results: completed, rollback: [] }, executedAt: new Date().toISOString() });
    this.addThought('done', '带回滚工作流执行完成', { results: completed });
    return { success: true, status, rollback: [], results: completed };
  }

  async _rollback(completed, context = {}) {
    const rollback = [];
    for (const item of [...completed].reverse()) {
      const tool = this.getTool(item.toolName);
      if (typeof tool?.undo !== 'function') {
        rollback.push({ tool: item.toolName, status: 'skipped', reason: '该工具未实现 undo,需人工介入' });
        continue;
      }
      try {
        const result = await tool.undo(item.params, item.result, context);
        rollback.push({ tool: item.toolName, status: 'success', result });
      } catch (error) {
        rollback.push({ tool: item.toolName, status: 'failed', error: error.message });
      }
    }
    return rollback;
  }

  persistPlan(sessionId, userMessage, plan) {
    return createAgentPlan(sessionId, userMessage, { steps: plan.steps, confirmations: plan.confirmations });
  }

  getPlan(planId) {
    return getAgentPlan(planId);
  }

  listExecutions(planId, limit) {
    return listAgentExecutions(planId, limit);
  }

  listPlans(limit) {
    return listAgentPlans(limit);
  }
}

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

let singleton = null;
export function getAgent() {
  if (!singleton) singleton = new OperationsAgent();
  return singleton;
}

export { RISK_LEVELS };
