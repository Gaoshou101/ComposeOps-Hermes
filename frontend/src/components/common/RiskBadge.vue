<template>
  <span
    class="risk-badge inline-flex items-center gap-1.5 rounded-md border font-medium"
    :class="[data.cls, sizeCls]"
  >
    <span class="inline-flex h-1.5 w-1.5 shrink-0 rounded-full" :class="data.dot"></span>
    {{ data.label }}
  </span>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  risk: { type: String, default: '' },
  size: { type: String, default: 'sm', validator: (v) => ['xs', 'sm', 'md'].includes(v) },
});

// 统一风险文案与配色(全站唯一权威定义):低风险/中风险/高风险/极高风险
const RISK = {
  low: { label: '低风险', dot: 'bg-zinc-400', cls: 'border-zinc-700 bg-zinc-800/40 text-zinc-400' },
  medium: { label: '中风险', dot: 'bg-amber-400', cls: 'border-amber-900/50 bg-amber-950/40 text-amber-300' },
  high: { label: '高风险', dot: 'bg-rose-400', cls: 'border-rose-900/50 bg-rose-950/40 text-rose-300' },
  critical: { label: '极高风险', dot: 'bg-rose-500', cls: 'border-rose-900/70 bg-rose-950/60 text-rose-200' },
};

const data = computed(() => RISK[props.risk] || { label: '需确认', dot: 'bg-zinc-400', cls: 'border-zinc-700 bg-zinc-800/40 text-zinc-400' });
const sizeCls = computed(() => ({ xs: 'px-1.5 py-0 text-[10px]', sm: 'px-2 py-0.5 text-xs', md: 'px-2.5 py-1 text-sm' })[props.size]);
</script>
