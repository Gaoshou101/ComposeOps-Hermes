<template>
  <div class="page-shell page-shell-workspace">
    <div class="page-header">
      <div><h1 class="page-title">AI 运维助手</h1><p class="page-subtitle">日志上下文联动 · 容器只读探针 · 联网检索 Grounding</p></div>
      <div class="page-actions">
        <select v-model="projectId" class="input" @change="onProjectChange"><option value="">选择项目</option><option v-for="p in projects" :key="p.id" :value="p.id">{{ p.projectName }}</option></select>
        <select v-model="containerId" class="input" @change="onContainerChange"><option value="">选择容器</option><option v-for="c in containers" :key="c.id" :value="c.id">{{ c.name }}</option></select>
        <select v-model="activeSessionId" class="input max-w-44" title="诊断会话" @change="onSessionChange">
          <option value="">新对话(独立会话)</option>
          <option v-for="session in store.sessions" :key="session.sessionId" :value="session.sessionId">{{ session.title }}</option>
        </select>
        <button class="btn-secondary" :disabled="streaming || !containerId" @click="diagnose"><Stethoscope class="w-4 h-4" />诊断</button>
        <button class="icon-btn" title="重新载入历史" @click="loadHistory"><History class="w-4 h-4" /></button>
        <button v-if="activeSessionId" class="icon-btn" title="删除当前会话" @click="deleteSession(activeSessionId)"><Trash2 class="w-4 h-4" /></button>
        <button class="icon-btn" title="清空全部历史" @click="clearHistory"><History class="w-4 h-4" /></button>
      </div>
    </div>

    <p v-if="!store.config.apiKey" class="alert-warning">尚未配置 AI API Key,请先前往设置后使用。</p>

    <div class="flex min-h-0 flex-1 gap-3">
      <!-- 主对话区 -->
      <div class="flex min-w-0 flex-1 flex-col gap-3">
        <template v-if="!messages.length">
          <div class="flex flex-1 flex-col items-center justify-center gap-6 rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 px-6 py-12">
            <div class="grid h-14 w-14 place-items-center rounded-2xl border border-zinc-800 bg-zinc-900 text-cyan-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <Bot class="h-7 w-7" />
            </div>
            <div class="space-y-1.5 text-center">
              <h2 class="text-base font-semibold tracking-tight text-zinc-100">AI 运维助手</h2>
              <p class="mx-auto max-w-sm text-sm leading-6 text-zinc-500">结合容器日志上下文,执行只读探针,并支持联网检索权威文档。</p>
            </div>
            <div class="flex max-w-lg flex-wrap items-center justify-center gap-2">
              <button v-for="preset in presets" :key="preset" class="preset-chip" @click="input = preset; inputEl?.focus()">
                <Sparkles class="h-3.5 w-3.5 text-cyan-400" />{{ preset }}
              </button>
            </div>
          </div>
        </template>
        <div v-else ref="boxEl" class="card flex-1 min-h-[320px] overflow-auto p-4 space-y-3">
          <div v-for="message in messages" :key="message.id" class="flex" :class="message.role === 'user' ? 'justify-end' : 'justify-start'">
            <div class="max-w-[88%] min-w-0">
              <div class="message whitespace-pre-wrap break-words" :class="message.role === 'user' ? 'message-user' : 'message-assistant'">{{ message.content }}</div>
              <div v-if="message.probes && message.probes.length" class="mt-2 space-y-2">
                <div v-for="probe in message.probes" :key="probe.id" class="probe-card">
                  <div class="flex items-center gap-2">
                    <TerminalSquare class="h-3.5 w-3.5 shrink-0 text-cyan-400" />
                    <code class="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-300">{{ probe.command }}</code>
                    <button class="btn-secondary !min-h-7 !px-2 !py-1 text-[11px]" :disabled="probe.running" @click="runProbe(message, probe)">
                      <LoaderCircle v-if="probe.running" class="h-3.5 w-3.5 animate-spin" />{{ probe.running ? '执行中' : '在容器中执行' }}
                    </button>
                  </div>
                  <template v-if="probe.result">
                    <pre class="probe-output" :class="probe.result.exitCode === 0 ? 'text-emerald-200/90' : 'text-rose-300/90'">{{ probe.result.stdout || '(无输出)' }}</pre>
                    <div class="flex items-center gap-2 text-[10px] text-zinc-500">
                      <span>Exit {{ probe.result.exitCode ?? '—' }}</span><span>{{ probe.result.durationMs }}ms</span>
                      <span v-if="probe.result.exitCode !== 0" class="text-rose-400">命令返回非零,可继续追问 AI 分析</span>
                    </div>
                  </template>
                </div>
              </div>
              <div v-if="message.sources && message.sources.length" class="mt-2 flex flex-wrap gap-1.5">
                <a v-for="(source, index) in message.sources" :key="index" :href="source.url || '#'" target="_blank" rel="noopener noreferrer" class="source-badge" :class="{ 'pointer-events-none opacity-60': !source.url }">
                  <Globe class="h-3 w-3 shrink-0" />{{ source.title || `参考 ${index + 1}` }}
                </a>
              </div>
            </div>
          </div>
          <div v-if="streaming" class="flex justify-start"><div class="message message-assistant">{{ buffer }}<span class="animate-pulse">|</span></div></div>
        </div>

        <div class="ai-composer">
          <textarea ref="inputEl" v-model="input" class="input flex-1 resize-none border-0 bg-transparent px-1 py-1" rows="2" placeholder="输入问题,Enter 发送,Shift+Enter 换行" @keydown.enter.exact.prevent="send"></textarea>
          <div class="flex flex-col items-end gap-1.5">
            <label class="web-search-toggle" :title="webSearch ? '开启后 AI 将联网检索权威文档' : '点击开启联网检索'">
              <Globe class="h-3.5 w-3.5" :class="webSearch ? 'text-cyan-400' : 'text-zinc-600'" />
              <input v-model="webSearch" type="checkbox" />联网检索
            </label>
            <div class="flex items-center gap-2">
              <span v-if="selectedLogLines.length" class="mount-hint"><Check class="h-3 w-3" />已挂载 {{ selectedLogLines.length }} 条异常日志堆栈</span>
              <span class="hidden sm:inline text-[10px] text-zinc-600"><kbd class="shortcut-key">↵</kbd> 发送 · <kbd class="shortcut-key">⇧↵</kbd> 换行</span>
              <button v-if="!streaming" class="btn-primary self-end" :disabled="!input.trim()" @click="send"><Send class="w-4 h-4" />发送</button>
              <button v-else class="btn-danger self-end" @click="stop"><Square class="w-4 h-4" />停止</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧 Log-Context Inspector -->
      <aside class="log-inspector" :class="{ 'is-open': inspectorOpen }">
        <div class="flex items-center justify-between border-b border-zinc-800/70 px-3 py-2">
          <span class="flex items-center gap-1.5 text-xs font-medium text-zinc-300"><ScrollText class="h-3.5 w-3.5 text-cyan-400" />日志上下文</span>
          <div class="flex items-center gap-1">
            <button class="icon-btn !h-7 !w-7" title="刷新日志" :disabled="logLoading" @click="loadLogs"><RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': logLoading }" /></button>
            <button class="icon-btn !h-7 !w-7" title="收起" @click="inspectorOpen = false"><ChevronRight class="h-4 w-4" /></button>
          </div>
        </div>
        <div class="space-y-2 border-b border-zinc-800/70 p-2.5">
          <div class="flex gap-1.5">
            <button v-for="level in logLevels" :key="level.value" class="log-level-btn" :class="{ 'is-active': logLevel === level.value }" @click="logLevel = logLevel === level.value ? '' : level.value">{{ level.label }}</button>
          </div>
          <label class="search-field !min-h-8"><Search class="h-3.5 w-3.5" /><input v-model="logQuery" class="!py-1 text-xs" placeholder="检索日志..." /></label>
          <div class="flex items-center justify-between text-[11px] text-zinc-500">
            <span>{{ filteredLogs.length }} 行</span>
            <button class="text-cyan-400 hover:text-cyan-300" :disabled="!logLines.length" @click="selectAllErrors">{{ selectedAllErrors ? '取消全选' : '全选异常行' }}</button>
          </div>
        </div>
        <div class="log-lines flex-1 overflow-y-auto p-1.5">
          <p v-if="!containerId" class="px-2 py-6 text-center text-xs text-zinc-600">选择上方容器后加载实时日志</p>
          <p v-else-if="logLoading" class="px-2 py-6 text-center text-xs text-zinc-500">正在拉取日志…</p>
          <label v-for="log in filteredLogs" :key="log.id" class="log-line-item" :class="{ 'is-error': log.level === 'error', 'is-selected': selectedLogIds.includes(log.id) }">
            <input v-model="selectedLogIds" type="checkbox" :value="log.id" class="accent-cyan-500" />
            <span class="shrink-0 font-mono text-[9px] uppercase" :class="logLevelClass(log.level)">{{ log.level }}</span>
            <span class="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-400">{{ log.data }}</span>
          </label>
          <p v-if="containerId && !logLoading && !logLines.length" class="px-2 py-6 text-center text-xs text-zinc-600">暂无日志</p>
        </div>
        <div class="flex items-center justify-between border-t border-zinc-800/70 px-3 py-2">
          <span class="text-[10px] text-zinc-600">勾选的行将注入 Prompt</span>
          <button v-if="!inspectorOpen" class="icon-btn !h-7 !w-7" title="展开" @click="inspectorOpen = true"><ChevronLeft class="h-4 w-4" /></button>
        </div>
      </aside>
    </div>

    <ConfirmDialog
      :show="showDeleteDialog"
      title="删除诊断会话"
      message="删除该诊断会话?"
      tone="warning"
      confirm-text="删除"
      @confirm="confirmDeleteSession"
      @cancel="showDeleteDialog = false"
    />

    <ConfirmDialog
      :show="showClearDialog"
      title="清空全部历史"
      message="确认清空全部 AI 对话历史?"
      tone="danger"
      confirm-text="清空"
      @confirm="confirmClearHistory"
      @cancel="showClearDialog = false"
    />
  </div>
</template>
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { Bot, Check, ChevronLeft, ChevronRight, Globe, History, LoaderCircle, RefreshCw, ScrollText, Search, Send, Sparkles, Square, Stethoscope, TerminalSquare, Trash2 } from 'lucide-vue-next';
import { useAiStore } from '../stores/ai.js'; 
import { api, streamSse } from '../api/client.js';
import ConfirmDialog from '../components/common/ConfirmDialog.vue';
const route = useRoute(); const store = useAiStore(); const projects = ref([]); const projectId = ref(route.query.projectId || ''); const containerId = ref(route.query.containerId || ''); const messages = ref([]); const input = ref(''); const streaming = ref(false); const buffer = ref(''); const boxEl = ref(null); const inputEl = ref(null); let controller; let nextId = 0;
const webSearch = ref(false);
const activeSessionId = ref('');
const inspectorOpen = ref(true);
const logLines = ref([]);
const logLoading = ref(false);
const logLevel = ref('');
const logQuery = ref('');
const selectedLogIds = ref([]);
const showDeleteDialog = ref(false);
const showClearDialog = ref(false);
const pendingDeleteSessionId = ref('');
const logLevels = [
  { value: 'error', label: 'ERROR' },
  { value: 'warn', label: 'WARN' },
  { value: 'info', label: 'INFO' },
];
const presets = ['排查当前异常退出容器', '分析各容器内存消耗', '优化 Compose 配置'];
const containers = computed(() => projects.value.find((p) => p.id === projectId.value)?.containers || []);
const selectedLogLines = computed(() => logLines.value.filter((log) => selectedLogIds.value.includes(log.id)));
const selectedAllErrors = computed(() => {
  const errorLogs = logLines.value.filter((log) => log.level === 'error');
  return errorLogs.length > 0 && errorLogs.every((log) => selectedLogIds.value.includes(log.id));
});
const filteredLogs = computed(() => {
  let result = logLines.value;
  if (logLevel.value) result = result.filter((log) => log.level === logLevel.value);
  const needle = logQuery.value.trim().toLowerCase();
  if (needle) result = result.filter((log) => log.data.toLowerCase().includes(needle));
  return result;
});

function logLevelClass(level) {
  return { error: 'text-rose-400', warn: 'text-amber-400', info: 'text-zinc-500' }[level] || 'text-zinc-500';
}
async function onProjectChange() { containerId.value = ''; logLines.value = []; selectedLogIds.value = []; }
async function onContainerChange() { logLines.value = []; selectedLogIds.value = []; if (containerId.value) await loadLogs(); }
async function loadLogs() {
  if (!projectId.value || !containerId.value) return;
  logLoading.value = true;
  try {
    const res = await api.getProjectLogs(projectId.value, containerId.value);
    if (res && typeof res.logs === 'string') logLines.value = parseLogText(res.logs);
  } catch { logLines.value = []; }
  logLoading.value = false;
}
function parseLogText(text) {
  return String(text || '').split('\n').filter((line) => line.trim()).slice(-500).map((line, index) => {
    const lower = line.toLowerCase();
    const level = /(error|exception|fatal|panic|failed|crash)/i.test(line) ? 'error' : /(warn|deprecat)/i.test(line) ? 'warn' : 'info';
    return { id: `log-${index}-${Date.now()}`, level, data: line.slice(0, 300) };
  });
}
function selectAllErrors() {
  const errorLogs = logLines.value.filter((log) => log.level === 'error');
  selectedLogIds.value = selectedAllErrors.value
    ? selectedLogIds.value.filter((id) => !errorLogs.some((log) => log.id === id))
    : [...new Set([...selectedLogIds.value, ...errorLogs.map((log) => log.id)])];
}

onMounted(async () => {
  await Promise.all([store.loadConfig(), loadHistory(), store.loadSessions(), api.getProjects().then((r) => projects.value = r.projects.filter((project) => project.managed))]);
  if (containerId.value && projects.value.some((project) => project.id === projectId.value)) await loadLogs();
  if (route.query.diagnose === '1' && containerId.value && projects.value.some((project) => project.id === projectId.value)) diagnose();
});
async function loadHistory() { await store.loadHistory(activeSessionId.value || null); messages.value = store.history.map((m) => ({ id: m.id || ++nextId, role: m.role, content: m.content, sources: m.sources, probes: m.probes })); scroll(); }
async function onSessionChange() { messages.value = []; await loadHistory(); }
async function deleteSession(sessionId) {
  pendingDeleteSessionId.value = sessionId;
  showDeleteDialog.value = true;
}
async function confirmDeleteSession() {
  const sessionId = pendingDeleteSessionId.value;
  showDeleteDialog.value = false;
  await api.clearAiHistory(sessionId);
  if (activeSessionId.value === sessionId) activeSessionId.value = '';
  await store.loadSessions(); await loadHistory();
  pendingDeleteSessionId.value = '';
}
async function clearHistory() {
  showClearDialog.value = true;
}
async function confirmClearHistory() {
  showClearDialog.value = false;
  await store.clearHistory();
  messages.value = [];
  activeSessionId.value = '';
  await store.loadSessions();
}
async function send() {
  const text = input.value.trim(); if (!text || streaming.value) return;
  const mount = selectedLogLines.value.map((log) => log.data).join('\n');
  input.value = '';
  const userMsg = { id: ++nextId, role: 'user', content: mount ? `${text}\n\n--- 已挂载日志上下文 ---\n${mount}` : text };
  messages.value.push(userMsg);
  await chat('/ai/chat', { message: text, webSearch: webSearch.value, rawLogs: mount || undefined, failedCommand: text, exitCode: null, sessionId: activeSessionId.value || undefined });
}
async function diagnose() {
  const name = containers.value.find((c) => c.id === containerId.value)?.name || containerId.value;
  const mount = selectedLogLines.value.map((log) => log.data).join('\n');
  messages.value.push({ id: ++nextId, role: 'user', content: `诊断容器 ${name}${mount ? `\n\n--- 已挂载日志上下文 ---\n${mount}` : ''}` });
  await chat('/ai/diagnose', { projectId: projectId.value, containerId: containerId.value, rawLogs: mount || undefined, webSearch: webSearch.value, sessionId: activeSessionId.value || undefined });
}
async function chat(path, body) {
  streaming.value = true; buffer.value = ''; controller = new AbortController(); scroll();
  let currentMsg = null;
  try {
    await streamSse(path, body, (frame) => {
      if (frame.type === 'token') buffer.value += frame.data;
      if (frame.type === 'done') {
        currentMsg = { id: ++nextId, role: 'assistant', content: frame.data || buffer.value, sources: [], probes: [] };
        messages.value.push(currentMsg);
        buffer.value = '';
        extractProbes(currentMsg);
      }
      if (frame.type === 'sources') {
        if (currentMsg) currentMsg.sources = Array.isArray(frame.data) ? frame.data : [];
        else if (messages.value.length) messages.value[messages.value.length - 1].sources = Array.isArray(frame.data) ? frame.data : [];
      }
      if (frame.type === 'error') { messages.value.push({ id: ++nextId, role: 'assistant', content: `请求失败:${frame.data}` }); buffer.value = ''; }
      scroll();
    }, controller.signal);
  } catch (e) {
    if (e.name !== 'AbortError') messages.value.push({ id: ++nextId, role: 'assistant', content: `请求失败:${e.message}` });
  } finally {
    streaming.value = false; controller = null;
  }
}
function extractProbes(msg) {
  // 识别 AI 回复中的可执行只读命令(以 ```bash/sh/shell 代码块或独立命令行出现)
  const text = msg.content || '';
  const commands = new Set();
  const blockRe = /```(?:bash|sh|shell)?\s*\n([^\n`]+(?:\n[^\n`]+)*)\n```/g;
  let m;
  while ((m = blockRe.exec(text)) !== null) {
    for (const line of m[1].split('\n')) {
      const cmd = line.trim().replace(/^\$\s*/, '');
      if (cmd && /^(env|printenv|ps|netstat|ss|curl|wget|cat|head|tail|ls|df|du|free|uptime|uname|hostname|date|whoami|id|ip\s+addr|ping\s+-c)/.test(cmd)) commands.add(cmd.slice(0, 120));
    }
  }
  msg.probes = [...commands].slice(0, 3).map((command) => ({ id: `probe-${++nextId}`, command, running: false, result: null }));
}
async function runProbe(msg, probe) {
  if (!projectId.value || !containerId.value) return;
  probe.running = true;
  try {
    const result = await api.execContainer({ projectId: projectId.value, containerId: containerId.value, command: probe.command });
    probe.result = { stdout: result.stdout || '', exitCode: result.exitCode, durationMs: result.durationMs };
    // 自动追加一轮 AI 分析(探针结果回填)
    if (msg && typeof msg.content === 'string' && msg.content.trim()) {
      messages.value.push({ id: ++nextId, role: 'user', content: `探针命令 ${probe.command} 执行结果(Exit ${result.exitCode}):\n${String(result.stdout || '').slice(0, 4000)}` });
      void chat('/ai/chat', { message: `请基于上面的探针执行结果继续分析容器问题`, webSearch: webSearch.value, rawLogs: String(result.stdout || '').slice(0, 4000), sessionId: activeSessionId.value || undefined });
    }
  } catch (e) {
    probe.result = { stdout: `执行失败:${e.message}`, exitCode: -1, durationMs: 0 };
  } finally {
    probe.running = false;
  }
}
function stop() { controller?.abort(); }
function scroll() { nextTick(() => { if (boxEl.value) boxEl.value.scrollTop = boxEl.value.scrollHeight; }); }

onBeforeUnmount(stop);
</script>
