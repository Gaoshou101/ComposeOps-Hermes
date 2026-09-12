<template>
  <div v-if="open" class="agent-drawer-layer">
    <button class="agent-drawer-backdrop" aria-label="关闭 Agent" @click="closeAgent"></button>
    <aside class="agent-drawer" role="dialog" aria-modal="true" aria-label="页面 Agent">
      <header class="agent-drawer-head">
        <div class="flex min-w-0 items-center gap-2"><Bot class="h-4 w-4 text-cyan-400" /><div class="min-w-0"><strong class="block truncate">页面 Agent</strong><small class="block truncate">{{ pageContext.page || '当前页面' }} · {{ pageContext.mode || '运维问答与操作' }}</small></div></div>
        <div class="flex items-center gap-1"><button class="icon-btn" title="中断执行" :disabled="!running" @click="interrupt"><Square class="h-4 w-4" /></button><button class="icon-btn" title="关闭 Agent" @click="closeAgent"><X class="h-4 w-4" /></button></div>
      </header>
      <div class="agent-drawer-context"><span>已携带当前页面上下文</span><small>{{ contextSummary }}</small></div>
      <div ref="scrollEl" class="agent-drawer-messages" @click="handleRichBlockClick">
        <div v-if="!messages.length" class="agent-drawer-empty"><MessageCircle class="h-6 w-6 text-cyan-400" /><p>可以询问当前页面的数据、状态或操作方式。</p><button class="preset-chip" @click="input = defaultPrompt; focusInput()">{{ defaultPrompt }}</button></div>
        <article v-for="message in messages" :key="message.id" class="agent-drawer-message" :class="message.role">
          <div class="agent-drawer-avatar"><UserRound v-if="message.role === 'user'" class="h-3.5 w-3.5" /><Bot v-else class="h-3.5 w-3.5" /></div>
          <div class="min-w-0 max-w-[calc(100%-2rem)]"><div v-if="message.tools?.length" class="agent-drawer-tool-track"><span v-for="(tool, index) in message.tools" :key="index" class="agent-drawer-tool-chip" :class="tool.status"><i></i>{{ tool.tool }}<em v-if="tool.durationMs">{{ (tool.durationMs / 1000).toFixed(1) }}s</em></span></div><div v-if="message.role === 'assistant'" class="agent-drawer-markdown" v-html="renderMarkdown(message.content || (message.streaming ? '正在处理…' : ''))"></div><div v-else class="agent-drawer-user">{{ message.content }}</div>
            <div v-if="message.confirmation" class="agent-drawer-confirm"><strong>需要确认后执行</strong><p>{{ message.confirmation.description }}</p><div class="mt-2 flex gap-2"><button class="btn-primary !py-1 !text-xs" :disabled="message.confirmation.busy" @click="approve(message)">确认执行</button><button class="btn-secondary !py-1 !text-xs" :disabled="message.confirmation.busy" @click="reject(message)">拒绝</button></div></div>
          </div>
        </article>
      </div>
      <form class="agent-drawer-composer" @submit.prevent="submit"><textarea ref="inputEl" v-model="input" class="agent-input" rows="3" placeholder="询问当前页面或让 Agent 执行任务…" @keydown.enter.exact.prevent="submit"></textarea><div class="flex items-center justify-between gap-2"><small class="text-surface-500">{{ running ? '执行中，可随时中断' : '需要修改时会先请求确认' }}</small><button class="btn-primary" type="submit" :disabled="running || !input.trim()"><Send class="h-4 w-4" />发送</button></div></form>
    </aside>
    <teleport to="body">
      <div v-if="zoomOpen" class="rich-zoom-mask" @click.self="closeZoom()">
        <div class="rich-zoom-card agent-markdown">
          <button class="rich-zoom-close" title="关闭(Esc)" @click="closeZoom">×</button>
          <div class="rich-zoom-content" v-html="zoomContent"></div>
        </div>
      </div>
    </teleport>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { Bot, MessageCircle, Send, Square, UserRound, X } from 'lucide-vue-next';
import { useAgentConsole } from '../composables/useAgentConsole.js';
import { useAgentChat } from '../composables/useAgentChat.js';
import { useEscapeKey } from '../composables/useEscapeKey.js';
import { renderAgentMarkdown } from '../lib/agent-markdown.js';

const { open, context, closeAgent } = useAgentConsole();
const chat = useAgentChat();
const { messages, input, running, scrollEl, sendMessage, approve, reject, interrupt, handleRichBlockClick, zoomOpen, zoomContent, closeZoom } = chat;
const inputEl = ref(null);
const pageContext = computed(() => ({ page: context.value.page || '当前页面', route: window.location.hash.replace(/^#/, '') || '/', mode: context.value.mode || '运维问答与操作', summary: context.value.summary || '', state: context.value.state || '' }));
const contextSummary = computed(() => pageContext.value.summary || pageContext.value.state || '路由与页面状态已同步');
const defaultPrompt = computed(() => pageContext.value.mode === 'cron-editor' ? '根据当前表单帮我创建这个定时任务' : '请分析当前页面，并告诉我可以做什么');
useEscapeKey({ active: open, onClose: closeAgent, layer: 'drawer', lockBody: true });
function renderMarkdown(value) { return renderAgentMarkdown(value); }
function focusInput() { void nextTick(() => inputEl.value?.focus()); }
function submit() { void sendMessage(input.value.trim(), { pageContext: pageContext.value }); }
watch(open, (value) => { if (value) focusInput(); });
onBeforeUnmount(() => interrupt());
</script>

<style scoped>
.agent-drawer-layer { position: fixed; inset: 0; z-index: 51; pointer-events: none; }.agent-drawer-backdrop { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: rgba(0,0,0,.58); pointer-events: auto; }.agent-drawer { position: absolute; top: 0; right: 0; display: flex; width: min(100vw, 30rem); max-width: 100%; height: 100%; flex-direction: column; color: #d4d4d8; border-left: 1px solid #3f4653; background: #181c23; box-shadow: -18px 0 45px rgba(0,0,0,.35); pointer-events: auto; }.agent-drawer-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; border-bottom: 1px solid #303641; }.agent-drawer-head strong { font-size: 13px; color: #f4f4f5; }.agent-drawer-head small { color: #71717a; font-size: 10px; }.agent-drawer-context { padding: 9px 16px; border-bottom: 1px solid #272c35; background: #11151b; }.agent-drawer-context span, .agent-drawer-context small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.agent-drawer-context span { color: #67e8f9; font-size: 10px; }.agent-drawer-context small { margin-top: 2px; color: #71717a; font-size: 10px; }.agent-drawer-messages { min-height: 0; flex: 1; overflow-y: auto; padding: 16px; }.agent-drawer-empty { display: grid; min-height: 100%; place-content: center; justify-items: center; gap: 10px; color: #71717a; font-size: 12px; text-align: center; }.agent-drawer-message { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 16px; }.agent-drawer-message.user { flex-direction: row-reverse; }.agent-drawer-avatar { display: grid; width: 25px; height: 25px; flex: 0 0 auto; place-items: center; color: #67e8f9; border: 1px solid #155e75; border-radius: 7px; background: #082f49; }.agent-drawer-message.user .agent-drawer-avatar { color: #a1a1aa; border-color: #3f4653; background: #20252d; }.agent-drawer-user, .agent-drawer-markdown { padding: 8px 10px; border-radius: 8px; font-size: 12px; line-height: 1.65; }.agent-drawer-user { white-space: pre-wrap; background: #082f49; color: #f4f4f5; }.agent-drawer-markdown { background: #20252d; color: #d4d4d8; }.agent-drawer-markdown :deep(p) { margin: 0 0 7px; }.agent-drawer-markdown :deep(p:last-child) { margin-bottom: 0; }.agent-drawer-markdown :deep(pre) { overflow: auto; padding: 8px; background: #11151b; }.agent-drawer-markdown :deep(table) { display: block; width: 100%; margin: 7px 0; overflow-x: auto; border-collapse: collapse; font-size: 11px; }.agent-drawer-markdown :deep(th), .agent-drawer-markdown :deep(td) { padding: 4px 7px; border: 1px solid #303641; text-align: left; vertical-align: top; }.agent-drawer-markdown :deep(th) { color: #e4e4e7; font-weight: 600; background: #11151b; }.agent-drawer-markdown :deep(tr:nth-child(even) td) { background: rgba(17,21,27,.4); }.agent-drawer-markdown :deep(hr) { margin: 10px 0; border: 0; border-top: 1px solid #303641; }
.agent-drawer-tool-track { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
.agent-drawer-tool-chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px; color: #a1a1aa; border: 1px solid #303641; border-radius: 999px; background: #181c23; font-size: 9px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.agent-drawer-tool-chip em { color: #52525b; font-style: normal; }
.agent-drawer-tool-chip i { width: 5px; height: 5px; border-radius: 999px; background: #52525b; }
.agent-drawer-tool-chip.executing i { background: #22d3ee; }
.agent-drawer-tool-chip.done i { background: #34d399; }
.agent-drawer-tool-chip.failed i { background: #fb7185; }
.agent-drawer-tool-chip.rejected i { background: #a78bfa; }.agent-drawer-confirm { margin-top: 8px; padding: 10px; border: 1px solid rgba(146,64,14,.7); border-radius: 7px; background: rgba(69,26,3,.35); font-size: 11px; }.agent-drawer-confirm p { margin-top: 4px; color: #fde68a; line-height: 1.55; }.agent-drawer-composer { padding: 12px 16px 16px; border-top: 1px solid #303641; background: #151920; }.agent-drawer-composer .agent-input { display: block; width: 100%; min-height: 76px; max-height: 160px; margin-bottom: 9px; resize: vertical; padding: 10px 12px; color: #f4f4f5; border: 1px solid #46505e; border-radius: 9px; outline: none; background: #0f1319; font-size: 12px; line-height: 1.6; }.agent-drawer-composer .agent-input:focus { border-color: #0891b2; box-shadow: 0 0 0 2px rgba(8,145,178,.16); }.agent-drawer-composer small { font-size: 10px; }.agent-drawer-composer button[type='submit'] { flex: 0 0 auto; }
@media (max-width: 520px) { .agent-drawer-head, .agent-drawer-context, .agent-drawer-messages { padding-left: 12px; padding-right: 12px; } .agent-drawer-composer { padding: 10px 12px 12px; } .agent-drawer-composer small { max-width: 65%; line-height: 1.4; } }
</style>
