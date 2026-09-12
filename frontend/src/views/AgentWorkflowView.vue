<template>
  <div class="page-shell page-shell-workspace agent-page">
    <div class="page-header">
      <div><h1 class="page-title">AI 智能运维 Agent</h1><p class="page-subtitle hidden sm:block">在独立会话中查看纳管项目、分析资料并执行运维操作</p></div>
      <div class="page-actions flex-wrap">
        <select v-model="projectId" class="input w-full sm:w-auto !min-h-9 max-w-52 !py-1 text-xs" title="可选的当前项目上下文"><option value="">自动识别项目</option><option v-for="project in projects" :key="project.id" :value="project.id">{{ project.projectName }}</option></select>
        <button class="btn-secondary !min-h-9 !px-3 !text-xs" :disabled="loading" title="刷新纳管项目" @click="loadProjects"><RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': loading }" />刷新</button>
        <button v-if="running" class="btn-secondary !border-rose-900/60 !text-rose-300" title="中断当前 Agent 执行" @click="interrupt"><Square class="h-4 w-4" />中断</button>
      </div>
    </div>
    <div class="agent-layout">
      <aside class="agent-sessions card"><div class="agent-side-head"><div><h2>会话</h2><span>{{ filteredSessions.length }}/{{ sessions.length }} 个会话</span></div><button class="icon-btn" title="新建会话" @click="newSession"><Plus class="h-4 w-4" /></button></div><div class="px-3 pb-2"><label class="search-field !min-h-8"><Search class="h-3.5 w-3.5" /><input v-model="sessionQuery" class="!py-1 text-xs" placeholder="搜索会话..." /></label></div><div class="agent-session-list"><div v-if="!sessions.length" class="agent-empty-side">发送第一条消息后，会话会自动保存。</div><div v-else-if="!filteredSessions.length" class="agent-empty-side">没有匹配的会话。</div><div v-for="session in filteredSessions" :key="session.sessionId" class="agent-session-row" :class="{ active: session.sessionId === sessionId }"><template v-if="editingSessionId === session.sessionId"><input ref="renameInput" v-model="editingTitle" class="agent-session-rename" maxlength="80" @keydown.enter.prevent="saveRename(session)" @keydown.esc="cancelRename" @blur="saveRename(session)" /></template><button v-else class="agent-session-open" @click="openSession(session.sessionId)"><MessageSquare class="h-4 w-4 shrink-0" /><span class="min-w-0"><strong>{{ session.title || '未命名会话' }}</strong><small>{{ formatDate(session.createdAt) }} · {{ session.messageCount }} 条消息</small></span></button><button class="agent-session-edit" title="重命名会话" @click.stop="beginRename(session)"><Pencil class="h-3.5 w-3.5" /></button><button class="agent-session-delete" title="删除会话" @click.stop="deleteSession(session.sessionId)"><Trash2 class="h-3.5 w-3.5" /></button></div></div></aside>
      <main class="agent-chat card"><div class="agent-chat-head"><div class="flex min-w-0 items-center gap-2"><Bot class="h-4 w-4 text-cyan-400" /><div class="min-w-0"><strong class="block truncate">{{ activeTitle }}</strong><span class="agent-status">{{ webSearchEnabled ? '联网资料已开启' : '仅使用本地工具' }}</span></div></div><div class="agent-head-menu">
            <button class="icon-btn" title="更多操作" :disabled="!messages.length" @click="headMenuOpen = !headMenuOpen"><MoreHorizontal class="h-4 w-4" /></button>
            <div v-if="headMenuOpen" class="agent-head-dropdown">
              <button :disabled="!messages.length" @click="exportSession(); headMenuOpen = false"><Download class="h-3.5 w-3.5" />导出 Markdown</button>
              <button :disabled="!messages.length || running" @click="headMenuOpen = false; clearCurrentSession()"><Eraser class="h-3.5 w-3.5" />清空会话</button>
            </div>
            <div v-if="headMenuOpen" class="agent-head-menu-backdrop" @click="headMenuOpen = false"></div>
          </div></div>
        <div ref="scrollEl" class="agent-messages" @scroll.passive="onScroll" @click="handleRichBlockClick"><div v-if="loadingHistory" class="agent-loading">正在恢复会话…</div><div v-else-if="!messages.length" class="agent-welcome"><div class="agent-welcome-mark"><MessageCircle class="h-6 w-6" /></div><h2>这是一段新的运维会话</h2><p>可以先问我有哪些项目，也可以直接描述你要检查或修改的内容。</p><div class="agent-prompts"><button v-for="prompt in prompts" :key="prompt" class="preset-chip" @click="input = prompt; focusInput()"><Sparkles class="h-3.5 w-3.5 text-cyan-400" />{{ prompt }}</button></div></div><article v-for="message in messages" :key="message.id" class="agent-message" :class="message.role === 'user' ? 'user' : 'assistant'"><div class="agent-avatar"><UserRound v-if="message.role === 'user'" class="h-4 w-4" /><Bot v-else class="h-4 w-4" /></div><div class="agent-message-body"><div v-if="message.tools?.length" class="agent-tool-track"><span v-for="(tool, index) in message.tools" :key="index" class="agent-tool-chip" :class="tool.status"><i class="agent-tool-dot"></i>{{ tool.tool }}<em v-if="tool.durationMs">{{ (tool.durationMs / 1000).toFixed(1) }}s</em></span></div><template v-if="message.role === 'assistant'"><div v-if="message.streaming && !message.content" class="agent-typing"><i></i><i></i><i></i><span>正在处理</span></div><div v-else-if="!message.content && !message.streaming" class="agent-empty-reply">(未返回内容)</div><div v-else class="agent-markdown" v-html="renderMarkdown(message.content)"></div><button v-if="message.content" class="agent-copy-btn" title="复制本条回复" @click="copyMessage(message)"><Copy class="h-3 w-3" /></button></template><div v-else class="agent-user-text">{{ message.content }}</div><div v-if="message.projects?.length" class="agent-project-grid"><div v-for="project in message.projects" :key="project.id" class="agent-project-card"><div class="flex items-center justify-between gap-2"><strong>{{ project.name }}</strong><span :class="project.editable ? 'text-emerald-400' : 'text-amber-400'">{{ project.editable ? '可编辑' : '仅控制' }}</span></div><p>{{ project.composeMode || 'containers' }} · {{ project.services?.length || 0 }} 个服务</p><button @click="selectProject(project)">固定为当前项目</button></div></div><div v-if="message.confirmation" class="agent-confirm"><div class="flex items-start gap-2"><ShieldAlert class="mt-0.5 h-4 w-4 shrink-0 text-amber-400" /><div class="min-w-0"><strong>需要确认后执行<span v-if="message.confirmation.tool" class="ml-1.5 font-mono text-[11px] text-amber-200/80">{{ message.confirmation.tool }}</span></strong><p>{{ message.confirmation.description }}</p><details class="agent-confirm-params" @toggle="initParamsEdit($event, message)"><summary>查看 / 编辑参数</summary><textarea v-model="message.confirmation.paramsText" class="agent-confirm-params-text" rows="6" spellcheck="false"></textarea><p class="mt-1 text-[10px] text-amber-200/60">JSON 格式;确认时将以此覆盖原参数(敏感值已脱敏显示,未改动的字段会以原值执行)。</p></details></div></div><div class="mt-3 flex gap-2"><button class="btn-primary !py-1.5 !text-xs" :disabled="message.confirmation.busy" @click="approveWithParams(message)"><Check class="h-3.5 w-3.5" />确认执行</button><button class="btn-secondary !py-1.5 !text-xs" :disabled="message.confirmation.busy" @click="reject(message)">拒绝</button></div></div><div v-if="message.searchSources?.length" class="agent-sources"><div><Globe2 class="h-3.5 w-3.5" />参考来源</div><a v-for="source in message.searchSources" :key="source.url || source.title" :href="source.url" target="_blank" rel="noreferrer">{{ source.title || source.url || '搜索结果' }}<small>{{ source.snippet }}</small></a></div></div></article></div>
        <button v-if="!atBottom" class="agent-scroll-bottom" title="回到底部" @click="scrollToBottom"><ArrowDownToLine class="h-3.5 w-3.5" />回到底部</button>
        <div class="agent-composer"><div v-if="showLogPicker" class="agent-log-panel"><div class="agent-log-panel-head"><span>挂载容器日志</span><button class="text-xs text-zinc-500 hover:text-cyan-300" @click="showLogPicker = false">收起</button></div><LogContextPicker :projects="projects" @attach="onAttach" /></div><div v-if="showQuickPrompts" class="agent-log-panel"><div class="agent-log-panel-head"><span>常用指令</span><button class="text-xs text-zinc-500 hover:text-cyan-300" @click="showQuickPrompts = false">收起</button></div><div class="grid gap-1.5 sm:grid-cols-2"><button v-for="prompt in quickPrompts" :key="prompt" class="agent-quick-prompt" @click="applyQuickPrompt(prompt)"><Sparkles class="h-3.5 w-3.5 text-cyan-400" />{{ prompt }}</button></div></div><textarea ref="inputEl" v-model="input" class="agent-input" rows="3" placeholder="告诉 Agent 你想查看或操作什么…（Enter 发送，Shift+Enter 换行）" @keydown.enter.exact.prevent="submit"></textarea><div class="agent-composer-foot"><span class="flex min-w-0 items-center gap-2"><button class="agent-log-btn" :class="{ active: attachedCount }" title="选择容器日志,作为排障证据随消息发送" @click="showLogPicker = !showLogPicker"><ScrollText class="h-3.5 w-3.5" />挂载日志<em v-if="attachedCount">{{ attachedCount }}</em></button><button class="agent-log-btn" title="常用指令" @click="showQuickPrompts = !showQuickPrompts"><Wand2 class="h-3.5 w-3.5" />常用指令</button><button class="agent-log-btn" :class="{ active: webSearchEnabled }" title="开启后 Agent 可以检索 Docker、Compose 和软件官方资料" @click="webSearchEnabled = !webSearchEnabled"><Globe2 class="h-3.5 w-3.5" />联网搜索</button><span class="truncate">{{ running ? 'Agent 正在执行，你仍可以继续编辑输入内容' : '会话与上下文会自动保存' }}</span></span><button class="btn-primary" :disabled="running || !input.trim()" title="发送消息" @click="submit"><Send class="h-4 w-4" />发送</button></div></div>
      </main>
      <aside class="agent-inspector"><section class="card agent-inspector-card"><div class="agent-inspector-title"><span>当前上下文</span><button v-if="projectId" class="text-xs text-zinc-500 hover:text-cyan-300" @click="projectId = ''">清除</button></div><p v-if="selectedProject" class="text-sm text-cyan-300">{{ selectedProject.projectName }}</p><p v-else>未固定项目，Agent 会先从纳管项目中识别。</p></section><section class="card agent-inspector-card agent-activity-panel"><div class="agent-inspector-title"><span>执行动态</span><em v-if="running">运行中</em></div><div v-if="!activity.length" class="flex items-start gap-2 text-zinc-600"><Activity class="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>需要确认的变更会显示在这里。</span></div><div v-for="(item, index) in activity" :key="index" class="agent-activity-row"><b>{{ item.label }}</b><span>{{ item.text }}</span></div></section><section class="card agent-inspector-card"><div class="agent-inspector-title"><span>长期记忆</span><button class="text-xs text-cyan-400 hover:text-cyan-300" @click="loadMemories">刷新</button></div><p v-if="!memories.length" class="flex items-start gap-2"><Brain class="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>还没有保存的长期记忆。只有你明确要求“记住”时才会保存。</span></p><div v-for="memory in memories.slice(0, 5)" :key="memory.memoryKey" class="agent-memory"><strong>{{ memory.memoryKey }}</strong><span>{{ memory.value }}</span></div></section></aside>
    </div>
    <ConfirmDialog :show="deleteDialog.show" title="删除会话" message="删除该会话及其全部消息?" tone="warning" confirm-text="删除" @confirm="confirmDeleteSession" @cancel="deleteDialog.show = false" />
    <ConfirmDialog :show="clearDialog" title="清空当前会话" message="确认清空当前会话的全部消息?" tone="danger" confirm-text="清空" @confirm="confirmClearSession" @cancel="clearDialog = false" />
    <teleport to="body">
      <div v-if="zoomOpen" class="rich-zoom-mask" @click.self="closeZoom()" @wheel.prevent="onZoomWheel">
        <div class="rich-zoom-card agent-markdown" :style="{ transform: `scale(${zoomScale})` }">
          <button class="rich-zoom-close" title="关闭(Esc)" @click="closeZoom">×</button>
          <div class="rich-zoom-content" v-html="zoomContent"></div>
        </div>
      </div>
    </teleport>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import { Activity, ArrowDownToLine, Bot, Brain, Check, Copy, Download, Eraser, Globe2, MessageCircle, MessageSquare, MoreHorizontal, Pencil, Plus, RefreshCw, ScrollText, Search, Send, ShieldAlert, Sparkles, Square, SquarePen, Trash2, UserRound, Wand2 } from 'lucide-vue-next';
import { api } from '../api/client.js';
import { stripAgentProtocol } from '../lib/agent-text.js';
import { renderAgentMarkdown } from '../lib/agent-markdown.js';
import { useAgentChat } from '../composables/useAgentChat.js';
import { useToastStore } from '../stores/toast.js';
import ConfirmDialog from '../components/common/ConfirmDialog.vue';
import LogContextPicker from '../components/agent/LogContextPicker.vue';

const toast = useToastStore();

const projects = ref([]); const sessions = ref([]); const memories = ref([]); const activity = ref([]); const loading = ref(false); const loadingHistory = ref(false); const webSearchEnabled = ref(false); const projectId = ref(''); const inputEl = ref(null); const editingSessionId = ref(null); const editingTitle = ref('');
const attachedLogs = ref('');
const attachedCount = ref(0);
const showLogPicker = ref(false);
const showQuickPrompts = ref(false);
const headMenuOpen = ref(false);
const sessionQuery = ref('');
const quickPrompts = ['列出我可以操作的项目和状态', '帮我生成一个带健康检查的 compose 文件', '检查各容器资源占用并给出优化建议', '查看异常退出容器的日志并分析原因', '检查有哪些镜像可以更新', '磁盘空间不足时该怎么安全清理'];
const deleteDialog = reactive({ show: false, id: '' });
const clearDialog = ref(false);
const chat = useAgentChat({
  onEventExtra: (event) => { if (event.type === 'confirmation_required') appendActivity('需要确认 ', '请确认这项变更'); },
  onApproval: (message, kind) => { if (kind === 'approved') appendActivity('已确认 ', '变更继续执行'); else appendActivity('已拒绝 ', '变更未执行'); },
});
const { messages, input, running, sessionId, scrollEl, atBottom, onScroll, scrollBottom, scrollToBottom, nextMessageId, resetSession, sendMessage, approve, reject, interrupt, handleRichBlockClick, zoomOpen, zoomContent, zoomScale, onZoomWheel, closeZoom } = chat;
const prompts = ['查看我现在可以操作的项目', '搜索 sherpa-onnx-matcha-zh-tts 的 Docker Compose 信息', '记住我偏好先查看日志再执行重启'];
const sessionQueryLower = computed(() => sessionQuery.value.trim().toLowerCase());
const filteredSessions = computed(() => {
  const keyword = sessionQueryLower.value;
  if (!keyword) return sessions.value;
  return sessions.value.filter((session) => String(session.title || '').toLowerCase().includes(keyword) || String(session.sessionId).includes(keyword));
});
const selectedProject = computed(() => projects.value.find((project) => project.id === projectId.value)); const activeTitle = computed(() => sessions.value.find((session) => session.sessionId === sessionId.value)?.title || '新会话');
function renderMarkdown(content) { return renderAgentMarkdown(content); }
function formatDate(value) { return value ? new Date(`${value.replace(' ', 'T')}Z`).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''; }
function focusInput() { void nextTick(() => inputEl.value?.focus()); }
function appendActivity(label, text) { const item = { label, text: String(text || '') }; activity.value.push(item); }
function onAttach({ text, count }) { attachedLogs.value = text || ''; attachedCount.value = count || 0; }
function applyQuickPrompt(prompt) { input.value = prompt; showQuickPrompts.value = false; focusInput(); }
function initParamsEdit(event, message) {
  if (event.target.open && message.confirmation && message.confirmation.paramsText === undefined) {
    message.confirmation.paramsText = JSON.stringify(message.confirmation.params || {}, null, 2);
  }
}
function approveWithParams(message) {
  let inputOverride = null;
  const confirmation = message.confirmation;
  if (confirmation?.paramsText !== undefined && confirmation.paramsText.trim()) {
    try {
      inputOverride = JSON.parse(confirmation.paramsText);
    } catch {
      toast.error('参数不是合法 JSON,请修正后再确认');
      return;
    }
    if (!inputOverride || typeof inputOverride !== 'object' || Array.isArray(inputOverride)) {
      toast.error('参数必须是 JSON 对象');
      return;
    }
  }
  void approve(message, inputOverride);
}
function exportSession() {
  const header = `# ComposeOps 会话导出\n\n- 会话:${activeTitle.value}\n- 导出时间:${new Date().toLocaleString('zh-CN')}\n`;
  const body = messages.value
    .filter((message) => message.content)
    .map((message) => (message.role === 'user' ? `## 🧑 提问\n\n${message.content}` : `## 🤖 Agent\n\n${message.content}`))
    .join('\n\n---\n\n');
  const blob = new Blob([`${header}\n${body}\n`], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `composeops-session-${sessionId.value || 'export'}.md`;
  link.click();
  URL.revokeObjectURL(url);
  toast.success('会话已导出为 Markdown');
}
function copyMessage(message) {
  navigator.clipboard?.writeText(message.content).then(() => toast.success('已复制到剪贴板')).catch(() => toast.error('复制失败'));
}
async function loadProjects() { loading.value = true; try { projects.value = ((await api.getProjects(true)).projects || []).filter((project) => project.managed); } catch { projects.value = []; } finally { loading.value = false; } }
async function loadSessions() { sessions.value = (await api.getAiSessions(50)).sessions || []; } async function loadMemories() { try { memories.value = (await api.getAiMemories(20)).memories || []; } catch { memories.value = []; } }
function newSession() { resetSession(); activity.value = []; attachedLogs.value = ''; attachedCount.value = 0; showLogPicker.value = false; showQuickPrompts.value = false; focusInput(); }
async function openSession(id) { if (running.value) return; sessionId.value = Number(id); loadingHistory.value = true; activity.value = []; attachedLogs.value = ''; attachedCount.value = 0; showLogPicker.value = false; showQuickPrompts.value = false; try { const data = await api.getAiHistory(sessionId.value); messages.value = (data.messages || []).filter((item) => ['user', 'assistant'].includes(item.role)).map((item) => ({ id: nextMessageId(), role: item.role, content: stripAgentProtocol(item.content) })); } finally { loadingHistory.value = false; scrollBottom(); } }
function deleteSession(id) { deleteDialog.id = id; deleteDialog.show = true; }
async function confirmDeleteSession() {
  const id = deleteDialog.id;
  deleteDialog.show = false;
  if (!id || running.value) return;
  await api.clearAiHistory(id);
  sessions.value = sessions.value.filter((session) => session.sessionId !== id);
  if (sessionId.value === id) newSession();
}
function clearCurrentSession() { if (!sessionId.value || !messages.value.length || running.value) return; clearDialog.value = true; }
async function confirmClearSession() {
  clearDialog.value = false;
  await api.clearAiHistory(sessionId.value);
  messages.value = [];
  await loadSessions();
}
function beginRename(session) { editingSessionId.value = session.sessionId; editingTitle.value = session.title || ''; }
function cancelRename() { editingSessionId.value = null; editingTitle.value = ''; }
async function saveRename(session) { if (editingSessionId.value !== session.sessionId) return; const title = editingTitle.value.trim(); if (!title || title === session.title) { cancelRename(); return; } try { await api.renameAgentSession(session.sessionId, title); session.title = title; } catch (error) { window.alert(error.message); } finally { cancelRename(); } }
function selectProject(project) { projectId.value = project.id; input.value = `后续操作项目 ${project.name}`; focusInput(); }
async function submit() { const text = input.value.trim(); if (!text) return; showLogPicker.value = false; showQuickPrompts.value = false; await sendMessage(text, { projectId: projectId.value || undefined, webSearchEnabled: webSearchEnabled.value, attachedLogs: attachedLogs.value || undefined }); await Promise.all([loadSessions(), loadMemories()]); }
onMounted(async () => { await Promise.all([loadProjects(), loadSessions(), loadMemories()]); if (sessions.value.length) await openSession(sessions.value[0].sessionId); else focusInput(); });
</script>

<style scoped>
.agent-page { min-height: 0; }.agent-layout { display: grid; grid-template-columns: 238px minmax(0, 1fr) 260px; min-height: 0; flex: 1; gap: 12px; }.agent-sessions, .agent-chat, .agent-inspector-card { min-height: 0; }.agent-sessions { display: flex; flex-direction: column; overflow: hidden; }.agent-side-head, .agent-chat-head, .agent-inspector-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; }.agent-side-head { padding: 14px; border-bottom: 1px solid rgba(69,76,91,.55); }.agent-side-head h2 { color: #e5e7eb; font-size: 13px; font-weight: 700; }.agent-side-head span, .agent-status { color: #71717a; font-size: 10px; }.icon-btn { display: inline-grid; width: 30px; height: 30px; place-items: center; color: #a1a1aa; border: 1px solid #3f4653; border-radius: 7px; background: #20252d; }.icon-btn:hover { color: #67e8f9; border-color: #155e75; }.agent-session-list { overflow-y: auto; padding: 6px; }.agent-session-row { display: flex; align-items: center; gap: 3px; border-radius: 7px; color: #a1a1aa; }.agent-session-row.active { background: rgba(8,145,178,.14); color: #cffafe; }.agent-session-open { display: flex; min-width: 0; flex: 1; align-items: flex-start; gap: 9px; padding: 10px 7px; text-align: left; }.agent-session-open strong, .agent-session-open small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.agent-session-open strong { color: inherit; font-size: 12px; font-weight: 600; }.agent-session-open small { margin-top: 3px; color: #71717a; font-size: 10px; }.agent-session-delete { padding: 8px; color: #71717a; }.agent-session-delete:hover { color: #fb7185; }.agent-empty-side { padding: 16px 9px; color: #71717a; font-size: 11px; line-height: 1.6; }.agent-chat { position: relative; display: flex; flex-direction: column; overflow: hidden; }.agent-chat-head { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 10px; flex: 0 0 auto; padding: 13px 16px; border-bottom: 1px solid rgba(69,76,91,.55); }.agent-chat-head strong { color: #e4e4e7; font-size: 13px; }.agent-messages { min-height: 0; flex: 1; overflow-y: auto; padding: 22px clamp(12px,4vw,54px) 56px; }.agent-loading, .agent-welcome { display: grid; min-height: 100%; place-content: center; justify-items: center; text-align: center; }.agent-welcome-mark { display: grid; width: 52px; height: 52px; place-items: center; color: #67e8f9; border: 1px solid #164e63; border-radius: 14px; background: #082f49; }.agent-welcome h2 { margin-top: 14px; color: #f4f4f5; font-size: 17px; }.agent-welcome p { max-width: 430px; margin-top: 7px; color: #71717a; font-size: 13px; line-height: 1.7; }.agent-prompts { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 18px; }.agent-message { display: flex; max-width: 860px; margin: 0 auto 24px; align-items: flex-start; gap: 10px; }.agent-message.user { flex-direction: row-reverse; }.agent-avatar { display: grid; width: 28px; height: 28px; flex: 0 0 auto; place-items: center; color: #a1a1aa; border: 1px solid #3f4653; border-radius: 8px; background: #20252d; }.agent-message.assistant .agent-avatar { color: #67e8f9; border-color: #155e75; background: #082f49; }.agent-message-body { min-width: 0; max-width: calc(100% - 40px); }.agent-user-text { white-space: pre-wrap; word-break: break-word; padding: 10px 13px; color: #f4f4f5; border: 1px solid #164e63; border-radius: 10px 3px 10px 10px; background: rgba(8,47,73,.55); font-size: 13px; line-height: 1.6; }.agent-markdown { color: #d4d4d8; font-size: 13px; line-height: 1.75; }.agent-markdown :deep(p) { margin: 0 0 10px; }.agent-markdown :deep(p:last-child) { margin-bottom: 0; }.agent-markdown :deep(h1), .agent-markdown :deep(h2), .agent-markdown :deep(h3) { margin: 16px 0 8px; color: #f4f4f5; font-weight: 700; line-height: 1.35; }.agent-markdown :deep(h1) { font-size: 18px; }.agent-markdown :deep(h2) { font-size: 16px; }.agent-markdown :deep(h3) { font-size: 14px; }.agent-markdown :deep(ul), .agent-markdown :deep(ol) { margin: 8px 0; padding-left: 22px; }.agent-markdown :deep(li) { margin: 3px 0; }.agent-markdown :deep(code) { padding: 2px 5px; color: #a5f3fc; border-radius: 4px; background: #181c23; font-size: .9em; }.agent-markdown :deep(pre) { overflow: auto; margin: 10px 0; padding: 12px; border: 1px solid #303641; border-radius: 7px; background: #11151b; }.agent-markdown :deep(pre code) { padding: 0; background: transparent; }.agent-markdown :deep(blockquote) { margin: 10px 0; padding-left: 12px; color: #a1a1aa; border-left: 2px solid #155e75; }.agent-markdown :deep(a) { color: #67e8f9; text-decoration: underline; }.agent-markdown :deep(table) { display: block; width: 100%; margin: 10px 0; overflow-x: auto; border-collapse: collapse; font-size: 12px; }.agent-markdown :deep(th), .agent-markdown :deep(td) { padding: 6px 10px; border: 1px solid #303641; text-align: left; vertical-align: top; }.agent-markdown :deep(th) { color: #e4e4e7; font-weight: 600; background: #11151b; white-space: nowrap; }.agent-markdown :deep(tr:nth-child(even) td) { background: rgba(17,21,27,.4); }.agent-markdown :deep(hr) { margin: 14px 0; border: 0; border-top: 1px solid #303641; }.agent-project-grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(190px,1fr)); gap: 8px; margin-top: 12px; }.agent-project-card, .agent-confirm, .agent-sources { margin-top: 10px; padding: 11px; border: 1px solid #303641; border-radius: 8px; background: rgba(17,21,27,.72); }.agent-project-card strong { color: #e4e4e7; font-size: 12px; }.agent-project-card span { font-size: 10px; }.agent-project-card p { margin: 5px 0; color: #71717a; font-size: 11px; }.agent-project-card button { display: inline-flex; align-items: center; gap: 3px; margin-top: 7px; padding: 3px 8px; color: #67e8f9; border: 1px solid rgba(8, 145, 178, 0.4); border-radius: 6px; background: rgba(8, 145, 178, 0.08); font-size: 11px; transition: background 0.15s ease, border-color 0.15s ease; }
.agent-project-card button:hover { background: rgba(8, 145, 178, 0.18); border-color: #0891b2; }.agent-confirm { color: #fde68a; border-color: rgba(146,64,14,.7); background: rgba(69,26,3,.25); }.agent-confirm strong { font-size: 12px; }.agent-confirm p { margin-top: 4px; color: rgba(254,243,199,.7); font-size: 11px; }.agent-confirm pre { max-height: 130px; overflow: auto; margin-top: 8px; padding: 8px; color: #a1a1aa; background: rgba(0,0,0,.3); font-size: 10px; }.agent-sources > div { display: flex; align-items: center; gap: 5px; margin-bottom: 7px; color: #67e8f9; font-size: 11px; font-weight: 700; }.agent-sources a { display: block; overflow: hidden; color: #a1a1aa; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }.agent-sources a:hover { color: #67e8f9; }.agent-sources small { display: block; overflow: hidden; margin-top: 2px; color: #52525b; text-overflow: ellipsis; white-space: nowrap; }.agent-activity { display: flex; flex-wrap: wrap; gap: 6px 12px; margin-top: 9px; color: #71717a; font-size: 10px; }.agent-activity b { margin-right: 3px; color: #22d3ee; font-weight: 500; }.agent-composer { flex: 0 0 auto; padding: 12px 16px 14px; border-top: 1px solid rgba(69,76,91,.55); }.agent-input { display: block; width: 100%; resize: vertical; padding: 10px 12px; color: #e4e4e7; border: 1px solid #3f4653; border-radius: 8px; outline: none; background: #181c23; font-size: 13px; line-height: 1.6; }.agent-input:focus { border-color: #0891b2; box-shadow: 0 0 0 2px rgba(8,145,178,.15); }.agent-composer-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; color: #52525b; font-size: 10px; }.agent-inspector { display: flex; min-height: 0; flex-direction: column; gap: 12px; }.agent-inspector-card { padding: 14px; color: #71717a; font-size: 11px; line-height: 1.6; }.agent-inspector-title { margin-bottom: 9px; color: #d4d4d8; font-size: 12px; font-weight: 700; }.agent-inspector-title em { color: #22d3ee; font-size: 10px; font-style: normal; }.agent-activity-panel { min-height: 160px; flex: 1; overflow-y: auto; }.agent-activity-row { margin: 8px 0; }.agent-activity-row b { display: block; color: #22d3ee; font-size: 10px; font-weight: 600; }.agent-activity-row span { color: #71717a; font-size: 10px; }.agent-memory { padding: 7px 0; border-top: 1px solid #272c35; }.agent-memory strong, .agent-memory span { display: block; }.agent-memory strong { color: #a5f3fc; font-size: 11px; }.agent-memory span { color: #a1a1aa; font-size: 10px; }
@media (max-width: 1180px) { .agent-layout { grid-template-columns: 210px minmax(0,1fr); }.agent-inspector { display: none; } } @media (max-width: 760px) { .agent-layout { display: flex; flex-direction: column; }.agent-sessions { max-height: 142px; }.agent-session-list { display: flex; overflow-x: auto; gap: 4px; }.agent-session-row { min-width: 190px; }.agent-message-body { max-width: calc(100% - 38px); }.agent-composer-foot span { max-width: 65%; } }
.agent-session-edit { padding: 8px 3px; color: #71717a; }

/* chat-head 更多操作菜单 */
.agent-head-menu { position: relative; }
.agent-head-menu-backdrop { position: fixed; inset: 0; z-index: 30; }
.agent-head-dropdown { position: absolute; top: calc(100% + 6px); right: 0; z-index: 31; min-width: 168px; padding: 5px; border: 1px solid #303641; border-radius: 10px; background: #161b22; box-shadow: 0 14px 40px rgba(0,0,0,.5); animation: fade-rise .15s var(--ease-out-soft); }
.agent-head-dropdown button { display: flex; width: 100%; align-items: center; gap: 8px; padding: 8px 10px; color: #d4d4d8; border-radius: 7px; font-size: 12px; text-align: left; transition: background .12s ease; }
.agent-head-dropdown button:hover:not(:disabled) { background: #1f252e; color: #fff; }
.agent-head-dropdown button:disabled { color: #52525b; cursor: not-allowed; }

/* 正在处理:跳动点 */
.agent-typing { display: inline-flex; align-items: center; gap: 5px; padding: 4px 0; color: #71717a; font-size: 12px; }
.agent-typing i { width: 5px; height: 5px; border-radius: 999px; background: #22d3ee; animation: typing-bounce 1.1s var(--ease-spring) infinite; }
.agent-typing i:nth-child(2) { animation-delay: .14s; }
.agent-typing i:nth-child(3) { animation-delay: .28s; }
@keyframes typing-bounce { 0%, 60%, 100% { transform: translateY(0); opacity: .5; } 30% { transform: translateY(-4px); opacity: 1; } }
.agent-empty-reply { color: #52525b; font-size: 12px; font-style: italic; }

/* 确认卡参数编辑 */
.agent-confirm-params { margin-top: 7px; }
.agent-confirm-params summary { color: rgba(254, 243, 199, 0.85); font-size: 11px; cursor: pointer; user-select: none; }
.agent-confirm-params summary:hover { color: #fde68a; }
.agent-confirm-params-text { display: block; width: 100%; margin-top: 6px; padding: 8px 10px; color: #e4e4e7; border: 1px solid rgba(146, 64, 14, 0.5); border-radius: 7px; background: rgba(0, 0, 0, 0.3); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; line-height: 1.5; outline: none; resize: vertical; }
.agent-confirm-params-text:focus { border-color: #b45309; }

/* 工具执行轨迹 */
.agent-tool-track { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 7px; }
.agent-tool-chip { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; color: #a1a1aa; border: 1px solid #303641; border-radius: 999px; background: #181c23; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.agent-tool-chip em { color: #52525b; font-style: normal; }
.agent-tool-dot { width: 6px; height: 6px; flex: 0 0 auto; border-radius: 999px; background: #52525b; }
.agent-tool-chip.requested .agent-tool-dot { background: #fbbf24; }
.agent-tool-chip.executing .agent-tool-dot { background: #22d3ee; animation: tool-pulse 1s ease-in-out infinite; }
.agent-tool-chip.done .agent-tool-dot { background: #34d399; }
.agent-tool-chip.failed .agent-tool-dot { background: #fb7185; }
.agent-tool-chip.rejected .agent-tool-dot { background: #a78bfa; }
@keyframes tool-pulse { 0%, 100% { opacity: .4; } 50% { opacity: 1; } }

/* 复制按钮 */
.agent-message-body { position: relative; }
.agent-copy-btn { position: absolute; top: 0; right: 0; display: inline-grid; width: 24px; height: 24px; place-items: center; color: #52525b; border: 1px solid #303641; border-radius: 6px; background: rgba(24,28,35,.85); opacity: 0; transition: opacity .15s ease, color .15s ease; }
.agent-message:hover .agent-copy-btn { opacity: 1; }
.agent-copy-btn:hover { color: #67e8f9; }

/* 回底浮标 */
.agent-scroll-bottom { position: absolute; right: 20px; bottom: 148px; z-index: 15; display: inline-flex; align-items: center; gap: 5px; padding: 7px 12px; color: #a5f3fc; border: 1px solid #155e75; border-radius: 999px; background: rgba(8,47,73,.92); box-shadow: 0 6px 18px rgba(0,0,0,.4); animation: fade-rise .18s ease; font-size: 11px; }
.agent-scroll-bottom:hover { background: #0e7490; color: #fff; }
@keyframes fade-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }

/* 常用指令 */
.agent-quick-prompt { display: flex; align-items: center; gap: 7px; padding: 8px 10px; color: #d4d4d8; border: 1px solid #303641; border-radius: 8px; background: #181c23; font-size: 12px; text-align: left; transition: border-color .15s ease, background .15s ease; }
.agent-quick-prompt:hover { border-color: #155e75; background: #10151c; }

/* 日志挂载弹层 */
.agent-composer { position: relative; }
.agent-log-panel { position: absolute; bottom: calc(100% + 8px); left: 8px; right: 8px; z-index: 20; max-height: min(62vh, 480px); overflow-y: auto; padding: 12px 14px; border: 1px solid #303641; border-radius: 10px; background: #151920; box-shadow: 0 14px 40px rgba(0,0,0,.5); }
.agent-log-panel-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; color: #d4d4d8; font-size: 12px; font-weight: 700; }
.agent-log-btn { display: inline-flex; align-items: center; gap: 4px; color: #71717a; font-size: 11px; transition: color .15s ease; }
.agent-log-btn:hover { color: #67e8f9; }
.agent-log-btn.active { color: #22d3ee; }
.agent-log-btn em { min-width: 16px; padding: 0 4px; color: #a5f3fc; border-radius: 999px; background: #164e63; font-size: 10px; font-style: normal; text-align: center; }
.agent-session-edit:hover { color: #67e8f9; }
.agent-session-rename { min-width: 0; flex: 1; margin: 6px; padding: 5px 7px; color: #f4f4f5; border: 1px solid #155e75; border-radius: 5px; background: #11151b; font-size: 12px; outline: none; }
.agent-trace { margin-top: 10px; }
.agent-trace-toggle { display: inline-flex; align-items: center; gap: 5px; color: #71717a; font-size: 10px; }
.agent-trace-toggle:hover { color: #67e8f9; }
.agent-trace-toggle span { min-width: 16px; padding: 1px 4px; color: #a5f3fc; border-radius: 10px; background: #164e63; text-align: center; }
.agent-trace-list { display: grid; gap: 5px; margin-top: 7px; padding: 8px 10px; border-left: 2px solid #155e75; background: rgba(17,21,27,.55); }
.agent-trace-list div { display: grid; grid-template-columns: 92px minmax(0,1fr); gap: 7px; font-size: 10px; line-height: 1.5; }
.agent-trace-list b { color: #67e8f9; font-weight: 500; }
.agent-trace-list span { color: #a1a1aa; }
.agent-trace-list small { grid-column: 2; overflow-wrap: anywhere; color: #52525b; }

/* 大屏:让对话内容更充分使用横向空间 */
@media (min-width: 1600px) {
  .agent-messages { padding-left: clamp(24px, 5vw, 76px); padding-right: clamp(24px, 5vw, 76px); }
  .agent-message { max-width: min(1040px, 96%); }
}
@media (min-width: 2200px) {
  .agent-message { max-width: min(1240px, 94%); }
}
</style>
