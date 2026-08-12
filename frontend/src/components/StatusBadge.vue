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
  stopped: { label: '已停止', cls: 'bg-surface-700 text-surface-400' },
  partial: { label: '部分异常', cls: 'bg-amber-900/40 text-amber-400' },
};
const info = computed(() => map[props.status] || { label: props.status || '未知', cls: 'bg-surface-700 text-surface-400' });
const cls = computed(() => info.value.cls);
const label = computed(() => info.value.label);
</script>
