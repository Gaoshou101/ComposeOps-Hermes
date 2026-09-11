<template>
  <div v-if="open" class="agent-drawer-layer">
    <button class="agent-drawer-backdrop" aria-label="关闭 Agent" @click="closeAgent"></button>
    <aside class="agent-drawer" role="dialog" aria-modal="true" aria-label="页面 Agent">
      <header class="agent-drawer-head">
        <div class="flex min-w-0 items-center gap-2"><Bot class="h-4 w-4 text-cyan-400" /><div class="min-w-0"><strong class="block truncate">页面 Agent</strong><small class="block truncate">{{ pageContext.page || '当前页面' }} · {{ pageContext.mode || '运维问答与操作' }}</small></div></div>
        <div class="flex items-center gap-1"><button class="icon-btn" title="中断执行" :disabled="!running" @click="interrupt"><Square class="h-4 w-4" /></button><button class="icon-btn" title="关闭 Agent" @click="closeAgent"><X class="h-4 w-4" /></button></div>
      </header>
      <div class="agent-drawer-context"><span>已携带当前页面上下文</span><small>{{ contextSummary }}</small></div>
      <div ref="scrollEl" class="agent-drawer-messages">
        <div v-if="!messages.length" class="agent-drawer-empty"><MessageCircle class="h-6 w-6 text-cyan-400" /><p>可以询问当前页面的数据、状态或操作方式。</p><button class="preset-chip" @click="input = defaultPrompt; focusInput()">{{ defaultPrompt }}</button></div>
        <article v-for="message in messages" :key="message.id" class="agent-drawer-message" :class="message.role">
          <div class="agent-drawer-avatar"><UserRound v-if="message.role === 'user'" class="h-3.5 w-3.5" /><Bot v-else class="h-3.5 w-3.5" /></div>
          <div class="min-w-0 max-w-[calc(100%-2rem)]"><div v-if="message.role === 'assistant'" class="agent-drawer-markdown" v-html="renderMarkdown(message.content || (message.streaming ? '正在处理…' : ''))"></div><div v-else class="agent-drawer-user">{{ message.content }}</div>
            <div v-if="message.confirmation" class="agent-drawer-confirm"><strong>需要确认后执行</strong><p>{{ message.confirmation.description }}</p><div class="mt-2 flex gap-2"><button class="btn-primary !py-1 !text-xs" :disabled="message.confirmation.busy" @click="approve(message)">确认执行</button><button class="btn-secondary !py-1 !text-xs" :disabled="message.confirmation.busy" @click="reject(message)">拒绝</button></div></div>
          </div>
        </article>
      </div>
      <form class="agent-drawer-composer" @submit.prevent="sendMessage"><textarea ref="inputEl" v-model="input" class="agent-input" rows="3" placeholder="询问当前页面或让 Agent 执行任务…" @keydown.enter.exact.prevent="sendMessage"></textarea><div class="flex items-center justify-between gap-2"><small class="text-surface-500">{{ running ? '执行中，可随时中断' : '需要修改时会先请求确认' }}</small><button class="btn-primary" type="submit" :disabled="running || !input.trim()"><Send class="h-4 w-4" />发送</button></div></form>
    </aside>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { Bot, MessageCircle, Send, Square, UserRound, X } from 'lucide-vue-next';
import { api } from '../api/client.js';
import { stripAgentProtocol } from '../lib/agent-text.js';
import { useAgentConsole } from '../composables/useAgentConsole.js';
import { useEscapeKey } from '../composables/useEscapeKey.js';
import { renderAgentMarkdown } from '../lib/agent-markdown.js';

const { open, context, closeAgent } = useAgentConsole();
const sessionId = ref(null); const messages = ref([]); const input = ref(''); const running = ref(false); const scrollEl = ref(null); const inputEl = ref(null); let nextId = 0; let controller = null;
const pageContext = computed(() => ({ page: context.value.page || '当前页面', route: window.location.hash.replace(/^#/, '') || '/', mode: context.value.mode || '运维问答与操作', summary: context.value.summary || '', state: context.value.state || '' }));
const contextSummary = computed(() => pageContext.value.summary || pageContext.value.state || '路由与页面状态已同步');
const defaultPrompt = computed(() => pageContext.value.mode === 'cron-editor' ? '根据当前表单帮我创建这个定时任务' : '请分析当前页面，并告诉我可以做什么');
useEscapeKey({ active: open, onClose: closeAgent, layer: 'drawer', lockBody: true });
function stringify(value) { try { return JSON.stringify(value, null, 2); } catch { return String(value); } }
function renderMarkdown(value) { return renderAgentMarkdown(value); }
function scrollBottom() { void nextTick(() => { if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight; }); }
function focusInput() { void nextTick(() => inputEl.value?.focus()); }
async function ensureSession() { if (sessionId.value) return; const result = await api.createAgentSession(); sessionId.value = Number(result.sessionId); }
function historyForRequest() { return messages.value.slice(-12).filter((item) => item.content).map(({ role, content }) => ({ role, content: content.slice(0, 12000) })); }
async function sendMessage() {
  const text = input.value.trim();
  if (!text || running.value) return;
  await ensureSession();
  const assistant = { id: ++nextId, role: 'assistant', content: '', streaming: true };
  messages.value.push({ id: ++nextId, role: 'user', content: text }, assistant); input.value = ''; running.value = true; controller = new AbortController(); scrollBottom();
  try {
    await api.agentExecuteStream({ message: text, sessionId: sessionId.value, role: 'planner', history: historyForRequest(), pageContext: pageContext.value }, (event) => handleEvent(event, assistant), controller.signal);
  } catch (error) { if (error.name !== 'AbortError') assistant.content = `执行失败：${error.message}`; }
  finally { assistant.streaming = false; running.value = false; controller = null; scrollBottom(); }
}
function handleEvent(event, assistant) {
  if (event.type === 'token') assistant.content += event.content;
  else if (event.type === 'confirmation_required') assistant.confirmation = { ...event, busy: false };
  else if (event.type === 'context_data' && event.kind === 'projects') assistant.projects = event.projects;
  else if (event.type === 'action_completed' && event.kind === 'cron_created') window.dispatchEvent(new CustomEvent('composeops:cron-agent-created', { detail: event.result || {} }));
  else if (event.type === 'error') assistant.content += `${assistant.content ? '\n\n' : ''}${stripAgentProtocol(event.content || 'Agent 执行失败')}`;
  else if (event.type === 'interrupted') assistant.content += `${assistant.content ? '\n\n' : ''}${stripAgentProtocol(event.reason || '执行已中断')}`;
  else if (event.type === 'done' && event.content) assistant.content = stripAgentProtocol(event.content);
  scrollBottom();
}
async function approve(message) { const confirmation = message.confirmation; if (!confirmation || confirmation.busy) return; confirmation.busy = true; try { await api.agentApprove({ executionId: confirmation.executionId, toolCallId: confirmation.toolCallId, approved: true }); message.confirmation = null; } catch (error) { confirmation.busy = false; message.content = `确认失败：${error.message}`; } }
async function reject(message) { const confirmation = message.confirmation; if (!confirmation || confirmation.busy) return; confirmation.busy = true; try { await api.agentApprove({ executionId: confirmation.executionId, toolCallId: confirmation.toolCallId, approved: false }); message.confirmation = null; } catch (error) { confirmation.busy = false; message.content = `拒绝失败：${error.message}`; } }
function interrupt() { controller?.abort(); }
watch(open, (value) => { if (value) focusInput(); });
onBeforeUnmount(() => controller?.abort());
</script>

<style scoped>
.agent-drawer-layer { position: fixed; inset: 0; z-index: 61; pointer-events: none; }.agent-drawer-backdrop { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: rgba(0,0,0,.58); pointer-events: auto; }.agent-drawer { position: absolute; top: 0; right: 0; display: flex; width: min(100vw, 30rem); max-width: 100%; height: 100%; flex-direction: column; color: #d4d4d8; border-left: 1px solid #3f4653; background: #181c23; box-shadow: -18px 0 45px rgba(0,0,0,.35); pointer-events: auto; }.agent-drawer-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; border-bottom: 1px solid #303641; }.agent-drawer-head strong { font-size: 13px; color: #f4f4f5; }.agent-drawer-head small { color: #71717a; font-size: 10px; }.agent-drawer-context { padding: 9px 16px; border-bottom: 1px solid #272c35; background: #11151b; }.agent-drawer-context span, .agent-drawer-context small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.agent-drawer-context span { color: #67e8f9; font-size: 10px; }.agent-drawer-context small { margin-top: 2px; color: #71717a; font-size: 10px; }.agent-drawer-messages { min-height: 0; flex: 1; overflow-y: auto; padding: 16px; }.agent-drawer-empty { display: grid; min-height: 100%; place-content: center; justify-items: center; gap: 10px; color: #71717a; font-size: 12px; text-align: center; }.agent-drawer-message { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 16px; }.agent-drawer-message.user { flex-direction: row-reverse; }.agent-drawer-avatar { display: grid; width: 25px; height: 25px; flex: 0 0 auto; place-items: center; color: #67e8f9; border: 1px solid #155e75; border-radius: 7px; background: #082f49; }.agent-drawer-message.user .agent-drawer-avatar { color: #a1a1aa; border-color: #3f4653; background: #20252d; }.agent-drawer-user, .agent-drawer-markdown { padding: 8px 10px; border-radius: 8px; font-size: 12px; line-height: 1.65; }.agent-drawer-user { white-space: pre-wrap; background: #082f49; color: #f4f4f5; }.agent-drawer-markdown { background: #20252d; color: #d4d4d8; }.agent-drawer-markdown :deep(p) { margin: 0 0 7px; }.agent-drawer-markdown :deep(p:last-child) { margin-bottom: 0; }.agent-drawer-markdown :deep(pre) { overflow: auto; padding: 8px; background: #11151b; }.agent-drawer-markdown :deep(table) { display: block; width: 100%; margin: 7px 0; overflow-x: auto; border-collapse: collapse; font-size: 11px; }.agent-drawer-markdown :deep(th), .agent-drawer-markdown :deep(td) { padding: 4px 7px; border: 1px solid #303641; text-align: left; vertical-align: top; }.agent-drawer-markdown :deep(th) { color: #e4e4e7; font-weight: 600; background: #11151b; }.agent-drawer-markdown :deep(tr:nth-child(even) td) { background: rgba(17,21,27,.4); }.agent-drawer-markdown :deep(hr) { margin: 10px 0; border: 0; border-top: 1px solid #303641; }.agent-drawer-confirm { margin-top: 8px; padding: 10px; border: 1px solid rgba(146,64,14,.7); border-radius: 7px; background: rgba(69,26,3,.35); font-size: 11px; }.agent-drawer-confirm p { margin-top: 4px; color: #fde68a; line-height: 1.55; }.agent-drawer-composer { padding: 12px 16px 16px; border-top: 1px solid #303641; background: #151920; }.agent-drawer-composer .agent-input { display: block; width: 100%; min-height: 76px; max-height: 160px; margin-bottom: 9px; resize: vertical; padding: 10px 12px; color: #f4f4f5; border: 1px solid #46505e; border-radius: 9px; outline: none; background: #0f1319; font-size: 12px; line-height: 1.6; }.agent-drawer-composer .agent-input:focus { border-color: #0891b2; box-shadow: 0 0 0 2px rgba(8,145,178,.16); }.agent-drawer-composer small { font-size: 10px; }.agent-drawer-composer button[type='submit'] { flex: 0 0 auto; }
@media (max-width: 520px) { .agent-drawer-head, .agent-drawer-context, .agent-drawer-messages { padding-left: 12px; padding-right: 12px; } .agent-drawer-composer { padding: 10px 12px 12px; } .agent-drawer-composer small { max-width: 65%; line-height: 1.4; } }
</style>
