import { redactValue } from './redaction.js';
import { stripTextToolProtocol } from '../services/ai.js';

const INTERNAL_TOKEN_PATTERN = /\btool[_ ]?ca(?:lls?)?\b|<\/?tool_call[^>]*>/gi;

function cleanText(value) {
  return stripTextToolProtocol(String(value || ''))
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
  if (event.type === 'token' || event.type === 'done') return { type: event.type, content: cleanText(event.content) };
  if (event.type === 'confirmation_required') {
    return {
      type: 'confirmation_required',
      executionId: String(event.executionId || ''),
      toolCallId: String(event.toolCallId || ''),
      description: cleanText(event.description) || '该操作会修改系统状态,请确认是否继续。',
    };
  }
  if (event.type === 'tool_result') {
    const result = redactValue(event.result?.result);
    if (event.tool === 'project.list_managed' && Array.isArray(result)) return { type: 'context_data', kind: 'projects', projects: result };
    if (event.tool === 'web.search' && Array.isArray(result?.sources)) return { type: 'context_data', kind: 'search_sources', sources: result.sources };
    if (event.tool === 'cron.create') return { type: 'action_completed', kind: 'cron_created', result: result || {} };
    return null;
  }
  if (event.type === 'tool_error' || event.type === 'error') return { type: 'error', content: cleanError(event.error || event.content) || 'Agent 执行失败' };
  if (event.type === 'interrupted') return { type: 'interrupted', reason: cleanText(event.reason || event.content) || '执行已中断' };
  return null;
}
