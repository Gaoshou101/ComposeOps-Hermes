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
  if (event.type === 'done') return { type: event.type, content: cleanText(event.content) };
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
    let summary = '';
    try {
      summary = JSON.stringify(result).slice(0, 240);
    } catch {}
    return { type: 'tool_result', tool: String(event.tool || ''), success: !!event.result?.success, durationMs: Number(event.result?.durationMs || 0), summary };
  }
  if (event.type === 'tool_requested') return { type: 'tool_requested', tool: String(event.tool || '') };
  if (event.type === 'tool_executing') return { type: 'tool_executing', tool: String(event.tool || '') };
  if (event.type === 'tool_rejected') return { type: 'tool_rejected', tool: String(event.tool || '') };
  if (event.type === 'tool_error') return { type: 'tool_error', tool: String(event.tool || ''), error: cleanError(event.error) };
  if (event.type === 'error') return { type: 'error', content: cleanError(event.error || event.content) || 'Agent 执行失败' };
  if (event.type === 'interrupted') return { type: 'interrupted', reason: cleanText(event.reason || event.content) || '执行已中断' };
  return null;
}
