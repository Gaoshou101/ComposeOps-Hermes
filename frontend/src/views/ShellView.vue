<template>
  <div class="h-full flex flex-col space-y-3">
    <div class="flex items-center gap-2 flex-wrap">
      <h1 class="text-xl font-semibold">容器终端</h1>
      <input
        v-model="containerId"
        class="input flex-1 min-w-[280px] font-mono text-xs"
        placeholder="容器 ID 或名称"
      />
      <input v-model="cmd" class="input w-32 font-mono text-xs" placeholder="sh / bash" />
      <button v-if="!connected" class="btn-primary" @click="connect">连接</button>
      <button v-else class="btn-danger" @click="disconnect">断开</button>
    </div>

    <p v-if="err" class="text-red-400 text-sm">{{ err }}</p>

    <div class="card flex-1 min-h-0 terminal-host">
      <div ref="termEl" class="w-full h-full"></div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { wsUrl } from '../api/client.js';

const route = useRoute();
const containerId = ref(route.query.containerId || '');
const cmd = ref('sh');
const connected = ref(false);
const err = ref('');
const termEl = ref(null);

let term;
let fit;
let ws;

onMounted(() => {
  term = new Terminal({
    fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace',
    fontSize: 13,
    cursorBlink: true,
    theme: { background: '#000000', foreground: '#e5e7eb' },
  });
  fit = new FitAddon();
  term.loadAddon(fit);
  term.open(termEl.value);
  nextTick(() => fit.fit());

  term.onData((d) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(d);
  });
  term.onResize(({ cols, rows }) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  });
});

function connect() {
  if (!containerId.value) {
    err.value = '请输入容器 ID';
    return;
  }
  disconnect();
  err.value = '';
  ws = new WebSocket(wsUrl(`/ws/exec?containerId=${encodeURIComponent(containerId.value)}&cmd=${encodeURIComponent(cmd.value)}`));
  ws.onopen = () => {
    connected.value = true;
    nextTick(() => fit.fit());
    ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
  };
  ws.onmessage = (ev) => {
    // 后端直接回写原始字节（文本帧）
    term.write(typeof ev.data === 'string' ? ev.data : '');
  };
  ws.onerror = () => (err.value = 'WebSocket 连接错误');
  ws.onclose = () => (connected.value = false);
}

function disconnect() {
  if (ws) {
    ws.onclose = null;
    try { ws.close(); } catch {}
    ws = null;
  }
  connected.value = false;
}

onBeforeUnmount(() => {
  disconnect();
  term?.dispose();
});
</script>
