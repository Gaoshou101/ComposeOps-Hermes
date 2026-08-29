<template>
  <div class="page-shell page-shell-workspace">
    <div class="page-header">
      <div><h1 class="page-title">容器终端</h1><p class="page-subtitle">受限于当前 Compose 项目的交互式 Shell</p></div>
      <div class="page-actions">
        <select v-model="projectId" class="input" @change="containerId = ''"><option value="">选择项目</option><option v-for="p in projects" :key="p.id" :value="p.id">{{ p.projectName }}</option></select>
        <select v-model="containerId" class="input"><option value="">选择容器</option><option v-for="c in containers" :key="c.id" :value="c.id">{{ c.name }}</option></select>
        <select v-model="cmd" class="input"><option value="sh">sh</option><option value="bash">bash</option></select>
        <button v-if="!connected" class="btn-primary" :disabled="!containerId || !capabilities.shellEnabled" @click="connect"><Plug class="w-4 h-4" />连接</button>
        <button v-else class="btn-danger" @click="disconnect"><Unplug class="w-4 h-4" />断开</button>
      </div>
    </div>
    <p v-if="!capabilities.shellEnabled" class="alert-warning">Web Shell 当前未启用，请在部署环境设置 ENABLE_SHELL=1。</p><p v-if="error" class="alert-error">{{ error }}</p>
    <div class="card relative flex-1 min-h-[420px] overflow-hidden terminal-host">
      <Skeleton v-if="!termReady" class="skeleton-workspace" rows="10" label="终端加载中" />
      <div ref="termEl" class="h-full w-full" :class="{ invisible: !termReady }"></div>
    </div>
  </div>
</template>
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { Plug, Unplug } from 'lucide-vue-next';
import Skeleton from '../components/common/Skeleton.vue';
import { Terminal } from '@xterm/xterm'; import { FitAddon } from '@xterm/addon-fit'; import '@xterm/xterm/css/xterm.css';
import { api, wsUrl } from '../api/client.js';
const route = useRoute(); const projects = ref([]); const projectId = ref(route.query.projectId || ''); const containerId = ref(route.query.containerId || ''); const cmd = ref('sh'); const connected = ref(false); const termReady = ref(false); const error = ref(''); const capabilities = ref({ shellEnabled: false }); const termEl = ref(null); let term; let fit; let ws; let resizeObserver;
const containers = computed(() => projects.value.find((p) => p.id === projectId.value)?.containers || []);
onMounted(async () => {
  [projects.value, capabilities.value] = await Promise.all([api.getProjects().then((r) => r.projects.filter((project) => project.managed)), api.getCapabilities()]);
  window.addEventListener('composeops:host-changed', onHostChanged);
  term = new Terminal({ fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace', fontSize: 13, cursorBlink: true, theme: { background: '#0b0d10', foreground: '#e5e7eb' } }); fit = new FitAddon(); term.loadAddon(fit); term.open(termEl.value); nextTick(() => { fit.fit(); termReady.value = true; });
  term.onData((data) => { if (ws?.readyState === WebSocket.OPEN) ws.send(data); }); term.onResize(({ cols, rows }) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows })); });
  resizeObserver = new ResizeObserver(() => fit.fit()); resizeObserver.observe(termEl.value);
  if (containerId.value && capabilities.value.shellEnabled && projects.value.some((project) => project.id === projectId.value)) connect();
});
function connect() {
  disconnect(); error.value = ''; term.clear();
  ws = new WebSocket(wsUrl(`/ws/exec?projectId=${encodeURIComponent(projectId.value)}&containerId=${encodeURIComponent(containerId.value)}&cmd=${cmd.value}`)); ws.binaryType = 'arraybuffer';
  ws.onopen = () => { connected.value = true; fit.fit(); ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows })); };
  ws.onmessage = async (event) => { if (typeof event.data === 'string') { try { const frame = JSON.parse(event.data); if (frame.type === 'error') error.value = frame.data; else term.write(event.data); } catch { term.write(event.data); } } else { term.write(new Uint8Array(event.data)); } };
  ws.onerror = () => error.value = '终端连接失败'; ws.onclose = () => connected.value = false;
}
function disconnect() { if (ws) { ws.onclose = null; ws.close(); ws = null; } connected.value = false; }
function onHostChanged() { disconnect(); projects.value = []; void api.getProjects().then((r) => { projects.value = r.projects.filter((project) => project.managed); }).catch(() => {}); }
onBeforeUnmount(() => { disconnect(); resizeObserver?.disconnect(); term?.dispose(); window.removeEventListener('composeops:host-changed', onHostChanged); });
</script>
