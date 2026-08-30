<template>
  <div class="page-shell page-shell-workspace">
    <div class="page-header">
      <div><h1 class="page-title">实时日志</h1><p class="page-subtitle">多容器聚合、着色分流与即时过滤</p></div>
      <div class="page-actions">
        <select v-model="projectId" class="input" @change="onProjectChange"><option value="">选择项目</option><option v-for="p in projects" :key="p.id" :value="p.id">{{ p.projectName }}</option></select>
        <button class="btn-secondary" :class="{ 'btn-primary': aggregateMode }" :disabled="!projectId" :title="aggregateMode ? '当前为聚合模式,点击切换为单容器' : '聚合所有选中容器' " @click="toggleAggregate"><Layers class="w-4 h-4" />{{ aggregateMode ? '聚合中' : '聚合' }}</button>
        <select v-if="!aggregateMode" v-model="containerId" class="input" @change="onContainerChange"><option value="">选择容器</option><option v-for="c in containers" :key="c.id" :value="c.id">{{ c.name }}</option></select>
        <select v-else v-model="selectedContainers" class="input" multiple size="1" title="聚合容器(按住 Ctrl 多选)"><option v-for="c in containers" :key="c.id" :value="c.id">{{ c.name }}</option></select>
        <select v-model="levelFilter" class="input w-24" title="级别过滤"><option value="">全部</option><option value="error">ERROR</option><option value="warn">WARN</option></select>
        <input v-model="search" class="input w-40" placeholder="搜索或 /regex/" />
        <button v-if="!connected" class="btn-primary" :disabled="!canConnect" @click="connect"><Play class="w-4 h-4" />连接</button>
        <button v-else class="btn-danger" @click="disconnect"><Square class="w-4 h-4" />断开</button>
        <button class="icon-btn" :title="paused ? '继续接收' : '暂停显示'" @click="togglePause"><Play v-if="paused" class="w-4 h-4" /><Pause v-else class="w-4 h-4" /></button>
        <button class="icon-btn" title="下载日志" :disabled="!filtered.length" @click="download"><Download class="w-4 h-4" /></button>
        <button class="icon-btn" title="清屏" @click="lines = []"><Trash2 class="w-4 h-4" /></button>
        <button v-if="hasErrors" class="btn-primary" @click="diagnosis = true"><Sparkles class="w-4 h-4" />✨ AI 诊断</button>
      </div>
    </div>

    <p v-if="error" class="alert-error">{{ error }}</p>
    <div class="flex items-center gap-3 text-muted">
      <span :class="connected ? 'text-emerald-400' : ''"><span class="status-dot" :class="connected ? 'bg-emerald-400' : 'bg-surface-600'"></span>{{ connected ? '已连接' : '未连接' }}</span>
      <span>{{ filtered.length }} 条</span>
      <span v-if="paused" class="text-amber-400">已暂停 · {{ pending.length }} 条待显示</span>
      <label class="toggle-label ml-auto"><input v-model="autoScroll" type="checkbox" />自动滚动</label>
    </div>

    <div ref="boxEl" class="terminal-output card flex-1 min-h-[420px]" @wheel="onWheel">
      <template v-if="aggregateMode">
        <LogLine v-for="line in filtered" :key="line.id" :line="line" />
      </template>
      <template v-else>
        <div v-for="line in filtered" :key="line.id" class="aggregate-line" :class="line.type === 'stderr' || line.type === 'error' ? 'text-rose-400' : 'text-surface-200'" style="white-space: pre-wrap; word-break: break-all;">{{ line.data }}</div>
      </template>
    </div>

    <button v-if="connected && autoScrollPaused && !paused" class="scroll-resume-chip" @click="resumeScroll">已暂停自动滚动(向上) · 点击回到底部</button>

    <AIDiagnosisModal v-if="diagnosis" :open="diagnosis" :project-id="projectId" :project-name="projectName" :container-id="containerId" :raw-logs="recentErrorLogs" :exit-code="null" @close="diagnosis = false" />
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { Download, Layers, Pause, Play, Sparkles, Square, Trash2 } from 'lucide-vue-next';
import { api, wsUrl } from '../api/client.js';
import AIDiagnosisModal from '../components/services/AIDiagnosisModal.vue';
import LogLine from '../components/logs/LogLine.vue';

const route = useRoute();
const projects = ref([]);
const projectId = ref(route.query.projectId || '');
const containerId = ref(route.query.containerId || '');
const aggregateMode = ref(false);
const selectedContainers = ref([]);
const levelFilter = ref('');
const tail = ref(200);
const lines = ref([]);
const pending = ref([]);
const search = ref('');
const connected = ref(false);
const paused = ref(false);
const autoScroll = ref(true);
const autoScrollPaused = ref(false);
const error = ref('');
const boxEl = ref(null);
const diagnosis = ref(false);
const sequence = ref(0);
let ws;
let wsSeg;

const containers = computed(() => projects.value.find((p) => p.id === projectId.value)?.containers || []);
const projectName = computed(() => projects.value.find((p) => p.id === projectId.value)?.projectName || '');
const hasErrors = computed(() => lines.value.some((line) => /(fatal|error|crash|exception|failed)/i.test(line.data)));
const recentErrorLogs = computed(() => lines.value.filter((line) => line.type === 'stderr' || line.type === 'error').map((line) => line.data).join('').slice(-50000));
const canConnect = computed(() => projectId.value && (aggregateMode.value || containerId.value));

const filtered = computed(() => {
  let result = lines.value;
  if (levelFilter.value === 'error') {
    result = result.filter((line) => /(error|exception|fatal|panic|failed)/i.test(line.data));
  } else if (levelFilter.value === 'warn') {
    result = result.filter((line) => /(warn|deprecat)/i.test(line.data) && !/(error|exception|fatal|panic|failed)/i.test(line.data));
  }
  const needle = search.value.trim();
  if (needle) {
    const regex = needle.length > 2 && needle.startsWith('/') && needle.endsWith('/')
      ? new RegExp(needle.slice(1, -1), 'i')
      : null;
    result = result.filter((line) => regex ? regex.test(line.data) : line.data.toLowerCase().includes(needle.toLowerCase()));
  }
  return result;
});

onMounted(async () => {
  projects.value = (await api.getProjects()).projects.filter((project) => project.managed);
  const prefs = await api.getPreferences();
  tail.value = prefs.logTail;
  if (containerId.value && projects.value.some((project) => project.id === projectId.value)) connect();
  // 仅当 URL 只有 projectId 时进入聚合模式(带 containerId 则单容器)
  aggregateMode.value = !!(route.query.projectId && !route.query.containerId);
  window.addEventListener('composeops:host-changed', onHostChanged);
});

function onHostChanged() { disconnect(); projects.value = []; void reloadProjects(); }
async function reloadProjects() {
  try {
    projects.value = (await api.getProjects()).projects.filter((project) => project.managed);
    if ((containerId.value || aggregateMode.value) && projects.value.some((project) => project.id === projectId.value)) connect();
  } catch {}
}
function onProjectChange() { containerId.value = ''; selectedContainers.value = []; disconnect(); lines.value = []; }
function onContainerChange() { disconnect(); lines.value = []; }
function toggleAggregate() {
  aggregateMode.value = !aggregateMode.value;
  selectedContainers.value = [];
  disconnect();
  lines.value = [];
}

function connect() {
  disconnect();
  error.value = '';
  if (aggregateMode.value) {
    const ids = selectedContainers.value.join(',');
    wsSeg = new WebSocket(wsUrl(`/ws/aggregated-logs?projectId=${encodeURIComponent(projectId.value)}&containers=${ids ? encodeURIComponent(ids) : ''}`));
    wsSeg.onopen = () => connected.value = true;
    wsSeg.onerror = () => error.value = '聚合日志连接失败';
    wsSeg.onclose = () => connected.value = false;
    wsSeg.onmessage = (event) => {
      try {
        const frame = JSON.parse(event.data);
        if (frame.type === 'line') {
          const item = { id: ++sequence.value, ...frame.data };
          pending.value.push(item);
          flushPending();
        } else if (frame.type === 'error') error.value = frame.data;
      } catch {}
    };
  } else {
    ws = new WebSocket(wsUrl(`/ws/logs?projectId=${encodeURIComponent(projectId.value)}&containerId=${encodeURIComponent(containerId.value)}&tail=${tail.value}`));
    ws.onopen = () => connected.value = true;
    ws.onerror = () => error.value = '日志连接失败';
    ws.onclose = () => connected.value = false;
    ws.onmessage = (event) => {
      try {
        const frame = JSON.parse(event.data);
        const item = { id: ++sequence.value, type: frame.type, data: frame.data };
        if (paused.value) pending.value.push(item);
        else append(item);
      } catch {}
    };
  }
}
function flushPending() {
  if (paused.value) return;
  for (const item of pending.value.splice(0)) append(item);
}
function append(item) {
  lines.value.push(item);
  if (lines.value.length > 5000) lines.value.splice(0, lines.value.length - 5000);
  if (autoScroll.value && !autoScrollPaused.value) {
    nextTick(() => { if (boxEl.value) boxEl.value.scrollTop = boxEl.value.scrollHeight; });
  }
}
function togglePause() { paused.value = !paused.value; if (!paused.value) flushPending(); }
function onWheel(event) {
  if (!connected.value || !autoScroll.value) return;
  if (event.deltaY < 0) { autoScrollPaused.value = true; return; }
  autoScrollPaused.value = false;
  nextTick(() => { if (boxEl.value) boxEl.value.scrollTop = boxEl.value.scrollHeight; });
}
function resumeScroll() { autoScrollPaused.value = false; nextTick(() => { if (boxEl.value) boxEl.value.scrollTop = boxEl.value.scrollHeight; }); }
function disconnect() {
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  if (wsSeg) { wsSeg.onclose = null; wsSeg.close(); wsSeg = null; }
  connected.value = false;
}
function download() {
  const blob = new Blob([filtered.value.map((l) => `${l.containerName || ''}${l.ts ? ' ' + l.ts : ''} ${l.data}`).join('\n')], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `composeops-${Date.now()}.log`;
  a.click();
  URL.revokeObjectURL(a.href);
}
onBeforeUnmount(() => { disconnect(); window.removeEventListener('composeops:host-changed', onHostChanged); });
</script>
