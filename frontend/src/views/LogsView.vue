<template>
  <div class="page-shell page-shell-workspace">
    <div class="page-header">
      <div><h1 class="page-title">实时日志</h1><p class="page-subtitle">搜索、暂停和导出容器输出</p></div>
      <div class="page-actions">
        <select v-model="projectId" class="input" @change="containerId = ''"><option value="">选择项目</option><option v-for="p in projects" :key="p.id" :value="p.id">{{ p.projectName }}</option></select>
        <select v-model="containerId" class="input"><option value="">选择容器</option><option v-for="c in containers" :key="c.id" :value="c.id">{{ c.name }}</option></select>
        <input v-model="search" class="input w-40" placeholder="搜索日志" />
        <input v-model.number="tail" type="number" min="10" max="5000" class="input w-20" title="初始日志行数" />
        <button v-if="!connected" class="btn-primary" :disabled="!containerId" @click="connect"><Play class="w-4 h-4" />连接</button>
        <button v-else class="btn-danger" @click="disconnect"><Square class="w-4 h-4" />断开</button>
        <button class="icon-btn" :title="paused ? '继续接收' : '暂停显示'" @click="togglePause"><Play v-if="paused" class="w-4 h-4" /><Pause v-else class="w-4 h-4" /></button>
        <button class="icon-btn" title="下载日志" :disabled="!lines.length" @click="download"><Download class="w-4 h-4" /></button>
        <button class="icon-btn" title="清屏" @click="lines = []"><Trash2 class="w-4 h-4" /></button>
        <button v-if="hasErrors" class="btn-primary" @click="diagnosis = true"><Sparkles class="w-4 h-4" />✨ AI 诊断</button>
      </div>
    </div>
    <p v-if="error" class="alert-error">{{ error }}</p>
    <div class="flex items-center gap-3 text-muted"><span :class="connected ? 'text-emerald-400' : ''">{{ connected ? '已连接' : '未连接' }}</span><span>{{ filtered.length }} 条</span><span v-if="paused" class="text-amber-400">已暂停 · {{ pending.length }} 条等待显示</span><label class="toggle-label ml-auto"><input v-model="autoScroll" type="checkbox" />自动滚动</label></div>
    <div ref="boxEl" class="terminal-output card flex-1 min-h-[360px]">
      <div v-for="line in filtered" :key="line.id" class="log-line" :class="line.type === 'stderr' || line.type === 'error' ? 'text-rose-400' : 'text-surface-200'">{{ line.data }}</div>
    </div>
    <AIDiagnosisModal v-if="diagnosis" :open="diagnosis" :project-id="projectId" :project-name="projectName" :container-id="containerId" :raw-logs="recentErrorLogs" :exit-code="null" @close="diagnosis = false" />
  </div>
</template>
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { Download, Pause, Play, Sparkles, Square, Trash2 } from 'lucide-vue-next';
import { api, wsUrl } from '../api/client.js';
import AIDiagnosisModal from '../components/services/AIDiagnosisModal.vue';
const route = useRoute(); const projects = ref([]); const projectId = ref(route.query.projectId || ''); const containerId = ref(route.query.containerId || '');
const tail = ref(200); const lines = ref([]); const pending = ref([]); const search = ref(''); const connected = ref(false); const paused = ref(false); const autoScroll = ref(true); const error = ref(''); const boxEl = ref(null); const diagnosis = ref(false); let ws; let sequence = 0;
const containers = computed(() => projects.value.find((p) => p.id === projectId.value)?.containers || []);
const projectName = computed(() => projects.value.find((p) => p.id === projectId.value)?.projectName || '');
const hasErrors = computed(() => lines.value.some((line) => /(fatal|error|crash|exception|failed)/i.test(line.data)));
const recentErrorLogs = computed(() => lines.value.filter((line) => line.type === 'stderr' || line.type === 'error').map((line) => line.data).join('').slice(-50000));
const filtered = computed(() => search.value ? lines.value.filter((line) => line.data.toLowerCase().includes(search.value.toLowerCase())) : lines.value);
onMounted(async () => { projects.value = (await api.getProjects()).projects.filter((project) => project.managed); const prefs = await api.getPreferences(); tail.value = prefs.logTail; if (containerId.value && projects.value.some((project) => project.id === projectId.value)) connect(); window.addEventListener('composeops:host-changed', onHostChanged); });
function onHostChanged() { disconnect(); projects.value = []; void reloadProjects(); }
async function reloadProjects() { try { projects.value = (await api.getProjects()).projects.filter((project) => project.managed); if (containerId.value && projects.value.some((project) => project.id === projectId.value)) connect(); } catch {} }
function connect() {
  disconnect(); error.value = '';
  ws = new WebSocket(wsUrl(`/ws/logs?projectId=${encodeURIComponent(projectId.value)}&containerId=${encodeURIComponent(containerId.value)}&tail=${tail.value}`));
  ws.onopen = () => connected.value = true; ws.onerror = () => error.value = '日志连接失败'; ws.onclose = () => connected.value = false;
  ws.onmessage = (event) => { try { const frame = JSON.parse(event.data); const item = { id: ++sequence, type: frame.type, data: frame.data }; if (paused.value) pending.value.push(item); else append(item); } catch {} };
}
function append(item) { lines.value.push(item); if (lines.value.length > 5000) lines.value.splice(0, lines.value.length - 5000); if (autoScroll.value) nextTick(() => { if (boxEl.value) boxEl.value.scrollTop = boxEl.value.scrollHeight; }); }
function togglePause() { paused.value = !paused.value; if (!paused.value) { for (const item of pending.value.splice(0)) append(item); } }
function disconnect() { if (ws) { ws.onclose = null; ws.close(); ws = null; } connected.value = false; }
function download() { const blob = new Blob([lines.value.map((l) => l.data).join('')], { type: 'text/plain' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `composeops-${Date.now()}.log`; a.click(); URL.revokeObjectURL(a.href); }
onBeforeUnmount(() => { disconnect(); window.removeEventListener('composeops:host-changed', onHostChanged); });
</script>
