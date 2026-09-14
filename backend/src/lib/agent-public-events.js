import { redactValue } from './redaction.js';
import { stripAgentInternalText } from './agent-protocol-core.js';
import { stripTextToolProtocol } from '../services/ai.js';

const INTERNAL_TOKEN_PATTERN = /\btool_(?:call|calls|ca)\b|<\/?tool(?:[_ ]?[a-z]*)?/gi;

function cleanText(value) {
  return stripAgentInternalText(stripTextToolProtocol(String(value || '')))
    .replace(INTERNAL_TOKEN_PATTERN, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function cleanError(value) {
  const text = cleanText(value);
  return text.replace(/(?:工具|tool)\s*[：:]?\s*[\w.-]+/gi, '操作');
}

export function toPublicAgentEvent(event) {
  if (!event || typeof event !== 'object') return null;
  // token 必须原样透传:分片在 ai.js 发射层已完成全量、有状态的协议剥离,
  // 这里若逐 token 再清洗(trim/正则),会吃掉分片边界的空白与换行,
  // 造成表格、代码块与前文粘连,以及英文词间空格丢失。
  if (event.type === 'token') return { type: 'token', content: String(event.content ?? '') };
  if (event.type === 'done') {
    // planId 是本次执行的审计主键,供前端把"点赞/点踩"精确写回对应计划。
    return { type: event.type, content: cleanText(event.content), planId: event.planId ? String(event.planId) : '' };
  }
  if (event.type === 'confirmation_required') {
    return {
      type: 'confirmation_required',
      executionId: String(event.executionId || ''),
      toolCallId: String(event.toolCallId || ''),
      tool: String(event.tool || ''),
      params: redactValue(event.params || {}),
      description: cleanText(event.description) || '该操作会修改系统状态,请确认是否继续。',
    };
  }
  if (event.type === 'tool_result') {
    const result = redactValue(event.result?.result);
    if (event.tool === 'project.list_managed' && Array.isArray(result)) return { type: 'context_data', kind: 'projects', projects: result };
    if (event.tool === 'web.search' && Array.isArray(result?.sources)) return { type: 'context_data', kind: 'search_sources', sources: result.sources };
    if (event.tool === 'cron.create') return { type: 'action_completed', kind: 'cron_created', result: result || {} };
    // 通用工具结果:只透出工具名/成败/耗时 + 脱敏截断的摘要,完整结果体不带给前端。
    // 失败时 result 为空,回退到 error/durationMs 组成的摘要,避免卡片"结果"栏整片空白。
    let summary = '';
    try {
      const source = result === undefined ? { error: event.result?.error || '执行失败', durationMs: Number(event.result?.durationMs || 0) } : result;
      const serialized = JSON.stringify(source);
      summary = typeof serialized === 'string' ? serialized.slice(0, 240) : '';
    } catch {}
    return {
      type: 'tool_result',
      tool: String(event.tool || ''),
      success: !!event.result?.success,
      durationMs: Number(event.result?.durationMs || 0),
      summary,
      error: event.result?.success ? '' : cleanError(event.result?.error || ''),
    };
  }
  if (event.type === 'tool_requested') {
    let paramsText = '';
    try { paramsText = JSON.stringify(redactValue(event.params || {})).slice(0, 600); } catch {}
    return { type: 'tool_requested', tool: String(event.tool || ''), paramsText };
  }
  // 思考/执行进度轨迹:元数据已脱敏,只透出阶段与一句话内容,供"执行动态"面板实时展示
  if (event.type === 'trace' && event.trace) {
    return {
      type: 'trace',
      phase: String(event.trace.phase || ''),
      content: cleanText(String(event.trace.content || '')).slice(0, 200),
      round: Number(event.trace.metadata?.loopCount) || 0,
    };
  }
  // 本次用户消息的落库 id:供前端"编辑并重发"时截断对应历史,保持前后端一致
  if (event.type === 'session_meta') {
    return { type: 'session_meta', userMessageId: Number(event.userMessageId) || 0 };
  }
  // 思考中占位:仅一句状态文案,供聊天气泡的"思考过程"折叠面板展示
  if (event.type === 'thinking') {
    return { type: 'thinking', content: cleanText(String(event.content || '')).slice(0, 200) };
  }
  if (event.type === 'tool_executing') return { type: 'tool_executing', tool: String(event.tool || '') };
  if (event.type === 'tool_rejected') return { type: 'tool_rejected', tool: String(event.tool || '') };
  if (event.type === 'tool_error') return { type: 'tool_error', tool: String(event.tool || ''), error: cleanError(event.error) };
  if (event.type === 'error') return { type: 'error', content: cleanError(event.error || event.content) || 'Agent 执行失败' };
  if (event.type === 'interrupted') return { type: 'interrupted', reason: cleanText(event.reason || event.content) || '执行已中断' };
  return null;
}
