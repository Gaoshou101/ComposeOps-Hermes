<template>
  <div class="h-full flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <div class="mr-auto"><h1 class="page-title">容器终端</h1><p class="page-subtitle">受限于当前 Compose 项目的交互式 Shell</p></div>
      <select v-model="projectId" class="input" @change="containerId = ''"><option value="">选择项目</option><option v-for="p in projects" :key="p.id" :value="p.id">{{ p.projectName }}</option></select>
      <select v-model="containerId" class="input"><option value="">选择容器</option><option v-for="c in containers" :key="c.id" :value="c.id">{{ c.name }}</option></select>
      <select v-model="cmd" class="input"><option value="sh">sh</option><option value="bash">bash</option></select>
      <button v-if="!connected" class="btn-primary" :disabled="!containerId || !capabilities.shellEnabled" @click="connect"><Plug class="w-4 h-4" />连接</button>
      <button v-else class="btn-danger" @click="disconnect"><Unplug class="w-4 h-4" />断开</button>
    </div>
    <p v-if="!capabilities.shellEnabled" class="alert-warning">Web Shell 当前未启用，请在部署环境设置 ENABLE_SHELL=1。</p><p v-if="error" class="alert-error">{{ error }}</p>
    <div class="card flex-1 min-h-[420px] terminal-host"><div ref="termEl" class="w-full h-full"></div></div>
  </div>
</template>
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { Plug, Unplug } from 'lucide-vue-next';
import { Terminal } from '@xterm/xterm'; import { FitAddon } from '@xterm/addon-fit'; import '@xterm/xterm/css/xterm.css';
import { api, wsUrl } from '../api/client.js';
const route = useRoute(); const projects = ref([]); const projectId = ref(route.query.projectId || ''); const containerId = ref(route.query.containerId || ''); const cmd = ref('sh'); const connected = ref(false); const error = ref(''); const capabilities = ref({ shellEnabled: false }); const termEl = ref(null); let term; let fit; let ws; let resizeObserver;
const containers = computed(() => projects.value.find((p) => p.id === projectId.value)?.containers || []);
onMounted(async () => {
  [projects.value, capabilities.value] = await Promise.all([api.getProjects().then((r) => r.projects), api.getCapabilities()]);
  term = new Terminal({ fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace', fontSize: 13, cursorBlink: true, theme: { background: '#0b0d10', foreground: '#e5e7eb' } }); fit = new FitAddon(); term.loadAddon(fit); term.open(termEl.value); nextTick(() => fit.fit());
  term.onData((data) => { if (ws?.readyState === WebSocket.OPEN) ws.send(data); }); term.onResize(({ cols, rows }) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows })); });
  resizeObserver = new ResizeObserver(() => fit.fit()); resizeObserver.observe(termEl.value);
  if (containerId.value && capabilities.value.shellEnabled) connect();
});
function connect() {
  disconnect(); error.value = ''; term.clear();
  ws = new WebSocket(wsUrl(`/ws/exec?projectId=${encodeURIComponent(projectId.value)}&containerId=${encodeURIComponent(containerId.value)}&cmd=${cmd.value}`)); ws.binaryType = 'arraybuffer';
  ws.onopen = () => { connected.value = true; fit.fit(); ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows })); };
  ws.onmessage = async (event) => { if (typeof event.data === 'string') { try { const frame = JSON.parse(event.data); if (frame.type === 'error') error.value = frame.data; else term.write(event.data); } catch { term.write(event.data); } } else { term.write(new Uint8Array(event.data)); } };
  ws.onerror = () => error.value = '终端连接失败'; ws.onclose = () => connected.value = false;
}
function disconnect() { if (ws) { ws.onclose = null; ws.close(); ws = null; } connected.value = false; }
onBeforeUnmount(() => { disconnect(); resizeObserver?.disconnect(); term?.dispose(); });
</script>
