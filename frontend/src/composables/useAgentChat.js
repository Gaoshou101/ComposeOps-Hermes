import { nextTick, ref } from 'vue';
import { useEscapeKey } from './useEscapeKey.js';
import { api } from '../api/client.js';
import { stripAgentProtocol } from '../lib/agent-text.js';

/**
 * Agent 会话流的共享逻辑,Agent 工作台与全局页面 Agent 抽屉共用。
 *
 * - 会话历史以服务端 DB 为单一通道,前端不回传 history(有 sessionId 时后端只读 DB)。
 * - token 分片由服务端保证干净,这里原样追加;done 用后端最终全文覆盖自愈。
 * - onEventExtra/onApproval 供各界面挂自己的展示逻辑(执行动态面板等)。
 */
export function useAgentChat({ onEventExtra = null, onApproval = null } = {}) {
  const messages = ref([]);
  const input = ref('');
  const running = ref(false);
  const sessionId = ref(null);
  const scrollEl = ref(null);
  // 滚动跟随:用户向上回看时暂停自动滚底,回到底部(或手动点"回到底部")后恢复。
  const atBottom = ref(true);
  let nextId = 0;
  let controller = null;
  // token 节流:SSE 分片逐条追加会让 marked+DOMPurify 每个 chunk 全量重渲染,
  // 长回复时一顿一顿;缓冲 120ms 合并刷新,流式更顺滑。
  let tokenBuffer = '';
  let bufferingAssistant = null;
  let tokenTimer = null;

  function flushTokens() {
    if (tokenTimer) { clearTimeout(tokenTimer); tokenTimer = null; }
    if (bufferingAssistant && tokenBuffer) {
      bufferingAssistant.content += tokenBuffer;
      tokenBuffer = '';
    }
    bufferingAssistant = null;
  }

  function queueToken(assistant, chunk) {
    if (tokenTimer && bufferingAssistant && bufferingAssistant !== assistant) flushTokens();
    bufferingAssistant = assistant;
    tokenBuffer += chunk;
    if (!tokenTimer) tokenTimer = setTimeout(flushTokens, 120);
  }

  function isNearBottom() {
    const el = scrollEl.value;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  function onScroll() {
    atBottom.value = isNearBottom();
  }

  function scrollBottom(force = false) {
    if (!force && !atBottom.value) return; // 用户在回看历史,不打断
    void nextTick(() => { if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight; });
  }

  function scrollToBottom() {
    atBottom.value = true;
    scrollBottom(true);
  }

  async function ensureSession() {
    if (!sessionId.value) sessionId.value = Number((await api.createAgentSession()).sessionId);
    return sessionId.value;
  }

  /** 消息 ID 统一由此生成,保证历史回放与新消息之间 :key 不冲突。 */
  function nextMessageId() { return ++nextId; }

  function resetSession() {
    messages.value = [];
    sessionId.value = null;
    nextId = 0;
    controller?.abort();
    controller = null;
  }

  async function sendMessage(text, extraPayload = {}) {
    if (!text || running.value) return;
    await ensureSession();
    const assistant = { id: ++nextId, role: 'assistant', content: '', streaming: true };
    messages.value.push({ id: ++nextId, role: 'user', content: text }, assistant);
    input.value = '';
    running.value = true;
    controller = new AbortController();
    atBottom.value = true; // 发送即回到底部
    scrollBottom(true);
    try {
      await api.agentExecuteStream({ message: text, sessionId: sessionId.value, role: 'planner', ...extraPayload }, (event) => handleEvent(event, assistant), controller.signal);
    } catch (error) {
      if (error.name !== 'AbortError') assistant.content = `执行失败：${error.message}`;
    } finally {
      flushTokens();
      assistant.streaming = false;
      assistant.confirmation = null;
      running.value = false;
      controller = null;
      scrollBottom();
    }
  }

  /** 工具执行轨迹:requested → executing → done/failed/rejected,供消息区展示。 */
  function trackTool(assistant, event) {
    if (!assistant.tools) assistant.tools = [];
    const pending = [...assistant.tools].reverse().find((item) => item.tool === event.tool && ['requested', 'executing'].includes(item.status));
    if (event.type === 'tool_requested') assistant.tools.push({ tool: event.tool, status: 'requested' });
    else if (event.type === 'tool_executing') {
      if (pending) pending.status = 'executing';
      else assistant.tools.push({ tool: event.tool, status: 'executing' });
    } else if (event.type === 'tool_result') {
      const status = event.success ? 'done' : 'failed';
      if (pending) { pending.status = status; pending.durationMs = event.durationMs; }
      else assistant.tools.push({ tool: event.tool, status, durationMs: event.durationMs });
    } else if (event.type === 'tool_error') {
      if (pending) pending.status = 'failed';
      else assistant.tools.push({ tool: event.tool, status: 'failed' });
    } else if (event.type === 'tool_rejected') {
      if (pending) pending.status = 'rejected';
      else assistant.tools.push({ tool: event.tool, status: 'rejected' });
    }
  }

  function handleEvent(event, assistant) {
    if (event.type === 'token') {
      queueToken(assistant, event.content);
      scrollBottom();
    } else if (event.type === 'confirmation_required') {
      flushTokens();
      assistant.confirmation = { ...event, busy: false };
    } else if (event.type === 'context_data' && event.kind === 'projects') assistant.projects = event.projects;
    else if (event.type === 'context_data' && event.kind === 'search_sources') assistant.searchSources = event.sources;
    else if (event.type === 'action_completed' && event.kind === 'cron_created') window.dispatchEvent(new CustomEvent('composeops:cron-agent-created', { detail: event.result || {} }));
    else if (event.type.startsWith('tool_')) { trackTool(assistant, event); }
    else if (event.type === 'interrupted') { flushTokens(); assistant.confirmation = null; assistant.content += `${assistant.content ? '\n\n' : ''}${stripAgentProtocol(event.reason || '执行已中断')}`; }
    else if (event.type === 'error') { flushTokens(); assistant.confirmation = null; assistant.content += `${assistant.content ? '\n\n' : ''}${stripAgentProtocol(event.content || 'Agent 执行失败')}`; }
    else if (event.type === 'done') { flushTokens(); if (event.content) assistant.content = stripAgentProtocol(event.content); }
    onEventExtra?.(event, assistant);
    scrollBottom();
  }

  async function approve(message) {
    const confirmation = message.confirmation;
    if (!confirmation || confirmation.busy) return;
    confirmation.busy = true;
    try {
      await api.agentApprove({ executionId: confirmation.executionId, toolCallId: confirmation.toolCallId, approved: true });
      message.confirmation = null;
      onApproval?.(message, 'approved');
    } catch (error) {
      confirmation.busy = false;
      message.content = `确认失败：${error.message}`;
    }
  }

  async function reject(message) {
    const confirmation = message.confirmation;
    if (!confirmation || confirmation.busy) return;
    confirmation.busy = true;
    try {
      await api.agentApprove({ executionId: confirmation.executionId, toolCallId: confirmation.toolCallId, approved: false });
      message.confirmation = null;
      onApproval?.(message, 'rejected');
    } catch (error) {
      confirmation.busy = false;
      message.content = `拒绝失败：${error.message}`;
    }
  }

  function interrupt() { controller?.abort(); }

  /** 富内容块"放大查看"(页面内浮层,类似豆包)的状态与点击委托。 */
  const zoomOpen = ref(false);
  const zoomContent = ref('');

  function handleRichBlockClick(event) {
    const button = event.target.closest?.('.rich-zoom-btn');
    if (!button) return;
    const block = button.closest('.rich-block');
    if (!block) return;
    zoomContent.value = block.querySelector('.rich-block-body')?.innerHTML || block.innerHTML;
    zoomOpen.value = true;
  }

  function closeZoom() {
    zoomOpen.value = false;
    zoomContent.value = '';
  }

  // Esc 关闭放大浮层,并锁定背景滚动(复用全局弹层 Esc 分层体系)
  useEscapeKey({ active: zoomOpen, layer: 'modal', onClose: closeZoom, lockBody: true });

  return { messages, input, running, sessionId, scrollEl, atBottom, onScroll, scrollBottom, scrollToBottom, nextMessageId, ensureSession, resetSession, sendMessage, approve, reject, interrupt, handleRichBlockClick, zoomOpen, zoomContent, closeZoom };
}
