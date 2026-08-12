<template>
  <div class="h-full flex flex-col space-y-3">
    <div class="flex items-center gap-2 flex-wrap">
      <h1 class="text-xl font-semibold">实时日志</h1>
      <input
        v-model="containerId"
        class="input flex-1 min-w-[280px] font-mono text-xs"
        placeholder="容器 ID 或名称"
      />
      <label class="text-sm text-surface-400 flex items-center gap-1">
        tail
        <input v-model.number="tail" type="number" class="input w-20" />
      </label>
      <button v-if="!connected" class="btn-primary" @click="connect">连接</button>
      <button v-else class="btn-danger" @click="disconnect">断开</button>
      <button class="btn-ghost" @click="lines = []">清屏</button>
      <label class="text-sm text-surface-400 flex items-center gap-1">
        <input type="checkbox" v-model="autoScroll" class="accent-accent" /> 自动滚动
      </label>
    </div>

    <p v-if="err" class="text-red-400 text-sm">{{ err }}</p>

    <div ref="boxEl" class="card flex-1 min-h-0 overflow-auto p-3 font-mono text-xs leading-relaxed">
      <div
        v-for="(l, i) in lines"
        :key="i"
        :class="l.stream === 'stderr' ? 'text-red-400' : 'text-surface-200'"
      >{{ l.text }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, onBeforeUnmount, nextTick, watch } from 'vue';
import { useRoute } from 'vue-router';
import { wsUrl } from '../api/client.js';

const route = useRoute();
const containerId = ref(route.query.containerId || route.query.project || '');
const tail = ref(200);
const lines = ref([]);
const autoScroll = ref(true);
const connected = ref(false);
const err = ref('');
const boxEl = ref(null);
let ws;

function connect() {
  if (!containerId.value) {
    err.value = '请输入容器 ID';
    return;
  }
  disconnect();
  err.value = '';
  ws = new WebSocket(wsUrl(`/ws/logs?containerId=${encodeURIComponent(containerId.value)}&tail=${tail.value}`));
  ws.onopen = () => (connected.value = true);
  ws.onerror = () => (err.value = 'WebSocket 连接错误');
  ws.onclose = () => (connected.value = false);
  ws.onmessage = (ev) => {
    try {
      const frame = JSON.parse(ev.data);
      lines.value.push({ stream: frame.stream || 'stdout', text: frame.data });
      if (lines.value.length > 5000) lines.value.splice(0, lines.value.length - 5000);
      if (autoScroll.value) nextTick(scrollBottom);
    } catch {
      lines.value.push({ stream: 'stdout', text: ev.data });
    }
  };
}

function disconnect() {
  if (ws) {
    ws.onclose = null;
    try { ws.close(); } catch {}
    ws = null;
  }
  connected.value = false;
}

function scrollBottom() {
  if (boxEl.value) boxEl.value.scrollTop = boxEl.value.scrollHeight;
}

onBeforeUnmount(disconnect);
</script>
