import { nextTick, ref } from 'vue';
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
  let nextId = 0;
  let controller = null;

  function scrollBottom() {
    void nextTick(() => { if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight; });
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
    scrollBottom();
    try {
      await api.agentExecuteStream({ message: text, sessionId: sessionId.value, role: 'planner', ...extraPayload }, (event) => handleEvent(event, assistant), controller.signal);
    } catch (error) {
      if (error.name !== 'AbortError') assistant.content = `执行失败：${error.message}`;
    } finally {
      assistant.streaming = false;
      assistant.confirmation = null;
      running.value = false;
      controller = null;
      scrollBottom();
    }
  }

  function handleEvent(event, assistant) {
    if (event.type === 'token') assistant.content += event.content;
    else if (event.type === 'confirmation_required') assistant.confirmation = { ...event, busy: false };
    else if (event.type === 'context_data' && event.kind === 'projects') assistant.projects = event.projects;
    else if (event.type === 'context_data' && event.kind === 'search_sources') assistant.searchSources = event.sources;
    else if (event.type === 'action_completed' && event.kind === 'cron_created') window.dispatchEvent(new CustomEvent('composeops:cron-agent-created', { detail: event.result || {} }));
    else if (event.type === 'interrupted') { assistant.confirmation = null; assistant.content += `${assistant.content ? '\n\n' : ''}${stripAgentProtocol(event.reason || '执行已中断')}`; }
    else if (event.type === 'error') { assistant.confirmation = null; assistant.content += `${assistant.content ? '\n\n' : ''}${stripAgentProtocol(event.content || 'Agent 执行失败')}`; }
    else if (event.type === 'done' && event.content) assistant.content = stripAgentProtocol(event.content);
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

  return { messages, input, running, sessionId, scrollEl, scrollBottom, nextMessageId, ensureSession, resetSession, sendMessage, approve, reject, interrupt };
}
