<template>
  <header class="h-12 flex items-center justify-between px-4 bg-surface-900 border-b border-surface-800 shrink-0">
    <div class="flex items-center gap-2">
      <span class="text-lg font-semibold tracking-tight"> OpsDash </span>
      <span class="text-xs text-surface-500">ComposeOps</span>
    </div>
    <div class="flex items-center gap-3 text-sm">
      <span v-if="backendOnline" class="flex items-center gap-1.5 text-green-400">
        <span class="w-2 h-2 rounded-full bg-green-400"></span> backend
      </span>
      <span v-else class="flex items-center gap-1.5 text-red-400">
        <span class="w-2 h-2 rounded-full bg-red-400"></span> offline
      </span>
      <a
        :href="`http://${host}:3001/health`"
        target="_blank"
        class="text-surface-400 hover:text-surface-200"
        title="后端健康检查"
        >:3001</a
      >
    </div>
  </header>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';

const backendOnline = ref(false);
const host = location.hostname;
let timer;

async function ping() {
  try {
    const res = await fetch('/health');
    backendOnline.value = res.ok;
  } catch {
    backendOnline.value = false;
  }
}
onMounted(() => {
  ping();
  timer = setInterval(ping, 5000);
});
onUnmounted(() => clearInterval(timer));
</script>
