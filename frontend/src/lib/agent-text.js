import { scanIcallProtocols, stripAgentInternalText } from './agent-protocol-core.js';

/**
 * 前端兜底清洗:服务端(ai.js 发射层 + toPublicAgentEvent)已保证事件与落库历史干净,
 * 这里只对完整文本(历史回放、done/error 全文)再剥一次协议残片,防御旧版本
 * 会话里落库的残留;分片流式内容不做处理(会破坏分片边界的空白)。
 */
export function stripAgentProtocol(value) {
  return stripAgentInternalText(scanIcallProtocols(String(value || '')).content
    .replace(/<\/?tool_call[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<tool_call>[\s\S]*$/gi, '')
    .replace(/<\/?tool(?:[_ ]?[a-z]*)?/gi, '')
    .replace(/\btool_(?:call|calls|ca)\b/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim());
}
