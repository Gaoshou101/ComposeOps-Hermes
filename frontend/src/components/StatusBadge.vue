<template>
  <span
    class="text-xs px-2 py-0.5 rounded font-medium"
    :class="cls"
  >{{ label }}</span>
</template>

<script setup>
import { computed } from 'vue';
const props = defineProps({ status: String });
const map = {
  running: { label: '运行中', cls: 'bg-green-900/40 text-green-400' },
  queued: { label: '排队中', cls: 'bg-blue-900/40 text-blue-300' },
  pending: { label: '等待', cls: 'bg-surface-700 text-surface-300' },
  success: { label: '成功', cls: 'bg-green-900/40 text-green-400' },
  failed: { label: '失败', cls: 'bg-red-900/40 text-red-400' },
  interrupted: { label: '已中断', cls: 'bg-amber-900/40 text-amber-300' },
  stopped: { label: '已停止', cls: 'bg-surface-700 text-surface-400' },
  partial: { label: '部分异常', cls: 'bg-amber-900/40 text-amber-400' },
};
const info = computed(() => map[props.status] || { label: props.status || '未知', cls: 'bg-surface-700 text-surface-400' });
const cls = computed(() => info.value.cls);
const label = computed(() => info.value.label);
</script>
