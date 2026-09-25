/**
 * ComposeOps MCP 工具层(Hermes 定制 fork 新增)。
 *
 * 把 OperationsAgent 已注册的工具原样暴露成 MCP tools:名称、描述、参数 JSON Schema
 * 全部沿用注册表,执行统一走 agent.executeTool(),因此前置条件检查、四档权限门、
 * 参数校验、项目操作锁与后置验收与面板内的 AI Agent 完全同一条路径 —— MCP 只是
 * 换了条入口,不复制也不绕过任何一条规则。
 *
 * 三条与面板不同的取舍:
 *  - MCP 工具名只允许 [a-zA-Z0-9_-],`compose.up` → `compose_up`;调用前反查回原名。
 *  - 高危工具(risk 为 high/critical,或注册表声明需确认)必须由调用方显式传
 *    `confirm: true` 才执行。面板侧靠确认弹窗,而 MCP 通道没有 UI,用这个显式开关
 *    代替,避免模型把破坏性调用当成普通查询顺手发出去。
 *  - 默认屏蔽 critical 级维护动作与任意命令执行入口(DEFAULT_EXCLUDED_TOOLS),
 *    需要时用 MCP_EXCLUDE_TOOLS 覆盖(传空串即不额外屏蔽)。
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { getAgent } from '../services/agent.js';
import { redactValue } from '../lib/redaction.js';

export const MCP_SERVER_NAME = 'composeops';
export const MCP_SERVER_VERSION = '1.0.0';

/** 单次工具结果返回给调用方的字符上限,防止超长日志灌爆对方上下文。 */
export const TOOL_RESULT_MAX = 24000;

/** 默认不暴露的工具:critical 级维护动作 + 任意命令执行入口。 */
export const DEFAULT_EXCLUDED_TOOLS = ['maintenance.clean', 'app.deploy', 'compose.exec', 'server.command'];

/** MCP 调用方固定的会话标识,用于记忆/审计归属,与面板内的聊天会话区分开。 */
export const MCP_SESSION_ID = 'mcp:hermes';

/**
 * 解析需要屏蔽的工具名清单。
 * @param {string|undefined} raw MCP_EXCLUDE_TOOLS 原始值;未设置时用默认清单,空串表示不屏蔽。
 * @returns {string[]}
 */
export function resolveExcludedTools(raw = process.env.MCP_EXCLUDE_TOOLS) {
  if (raw === undefined || raw === null) return [...DEFAULT_EXCLUDED_TOOLS];
  return String(raw).split(',').map((item) => item.trim()).filter(Boolean);
}

/** 工具名转 MCP 合法名(点号等非法字符统一转下划线)。 */
export function toMcpToolName(name) {
  return String(name).replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** 是否需要调用方显式确认:注册表声明需确认,或风险等级为 high/critical。 */
export function needsConfirm(tool) {
  return tool?.confirmationRequired === true || tool?.risk === 'high' || tool?.risk === 'critical';
}

/**
 * 工具描述里附带风险与权限元数据,让调用方在发起调用前就能判断后果。
 * 模型读到的就是这段文本,所以风险等级必须写在描述里而不是藏在 _meta。
 */
function describeTool(tool) {
  const notes = [`风险等级:${tool.risk}`, `权限要求:${tool.requiredPermission}`];
  if (needsConfirm(tool)) notes.push('高危:调用时必须带 confirm=true');
  if (tool.requiresProject) notes.push('需要 projectId');
  return `${tool.description || tool.name}\n\n[ComposeOps] ${notes.join(' | ')}`;
}

/** 参数 schema 原样透传,仅在需要确认的工具上追加 confirm 开关。 */
function toInputSchema(tool) {
  const base = tool.parameters && typeof tool.parameters === 'object' ? tool.parameters : {};
  const schema = {
    ...base,
    type: 'object',
    properties: { ...(base.properties || {}) },
  };
  if (needsConfirm(tool)) {
    schema.properties.confirm = {
      type: 'boolean',
      description: '高危操作确认位:必须显式传 true 才会真正执行,缺省或 false 只返回提示',
    };
  }
  return schema;
}

/**
 * 列出对外暴露的工具(已过滤屏蔽项、已转 MCP 名)。
 * 转名后若出现重名,保留先注册的那个并记入 duplicates,避免静默覆盖。
 * @returns {{ tools: Array, duplicates: string[] }}
 */
export function listMcpTools(agent = getAgent(), { excluded = resolveExcludedTools() } = {}) {
  const excludedSet = new Set(excluded);
  const seen = new Map();
  const duplicates = [];
  for (const tool of agent.listTools()) {
    if (excludedSet.has(tool.name)) continue;
    const mcpName = toMcpToolName(tool.name);
    if (seen.has(mcpName)) {
      duplicates.push(`${mcpName}(${seen.get(mcpName).name} / ${tool.name})`);
      continue;
    }
    seen.set(mcpName, tool);
  }
  return { tools: [...seen.entries()].map(([mcpName, tool]) => ({ mcpName, tool })), duplicates };
}

/** 统一的结果包装:脱敏 + 截断 + 明确的 isError,便于调用方判断成败。 */
function wrapResult(payload, failed) {
  const safe = redactValue(payload);
  let text = JSON.stringify(safe, null, 2) ?? '';
  if (text.length > TOOL_RESULT_MAX) {
    text = `${text.slice(0, TOOL_RESULT_MAX)}\n…[已截断,完整结果见 ComposeOps 面板执行历史]`;
  }
  return { content: [{ type: 'text', text }], isError: failed === true };
}

function errorResult(message) {
  return wrapResult({ success: false, error: message }, true);
}

/**
 * 创建一次性的 MCP Server 实例(无状态模式:每个 HTTP 请求一套)。
 * @param {Object} [options]
 * @param {import('../services/agent/engine.js').OperationsAgent} [options.agent]
 * @param {string[]} [options.excluded]
 * @returns {Server}
 */
export function createMcpServer({ agent = getAgent(), excluded = resolveExcludedTools() } = {}) {
  const { tools, duplicates } = listMcpTools(agent, { excluded });
  const byMcpName = new Map(tools.map((entry) => [entry.mcpName, entry.tool]));
  const context = {
    sessionId: MCP_SESSION_ID,
    role: 'planner',
    // 联网检索默认关闭,与面板默认值保持一致;需要时由 MCP_WEB_SEARCH=1 打开。
    webSearchEnabled: process.env.MCP_WEB_SEARCH === '1',
  };

  const server = new Server(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  if (duplicates.length) {
    console.warn(`[mcp] 工具名转换后重名,已保留先注册者:${duplicates.join(', ')}`);
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(({ mcpName, tool }) => ({
      name: mcpName,
      description: describeTool(tool),
      inputSchema: toInputSchema(tool),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const mcpName = request?.params?.name;
    const tool = byMcpName.get(mcpName);
    if (!tool) return errorResult(`未暴露的工具:${mcpName}`);

    const args = { ...(request?.params?.arguments || {}) };
    const confirmed = args.confirm === true;
    delete args.confirm;
    if (needsConfirm(tool) && !confirmed) {
      return errorResult(`工具 ${tool.name} 风险等级为 ${tool.risk},MCP 通道没有确认弹窗:确认要执行请带 confirm=true 重新调用。`);
    }

    try {
      const outcome = await agent.executeTool(tool.name, args, context, []);
      return wrapResult({
        tool: tool.name,
        success: outcome.success === true,
        durationMs: outcome.durationMs,
        result: outcome.result ?? null,
        error: outcome.error ?? null,
      }, outcome.success !== true);
    } catch (error) {
      return errorResult(`${tool.name} 执行失败:${error.message}`);
    }
  });

  return server;
}
