<template>
  <header class="h-12 flex items-center justify-between px-4 bg-surface-900 border-b border-surface-800 shrink-0">
    <div class="flex items-center gap-2">
      <Boxes class="w-5 h-5 text-accent" />
      <span class="text-base font-semibold">ComposeOps</span>
    </div>
    <div class="flex items-center gap-3 text-sm">
      <span v-if="backendOnline" class="flex items-center gap-1.5 text-green-400">
        <span class="w-2 h-2 rounded-full bg-green-400"></span> backend
      </span>
      <span v-else class="flex items-center gap-1.5 text-red-400">
        <span class="w-2 h-2 rounded-full bg-red-400"></span> offline
      </span>
      <button class="icon-btn" title="退出登录" @click="$emit('logout')"><LogOut class="w-4 h-4" /></button>
    </div>
  </header>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { Boxes, LogOut } from 'lucide-vue-next';

const backendOnline = ref(false);
defineEmits(['logout']);
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
