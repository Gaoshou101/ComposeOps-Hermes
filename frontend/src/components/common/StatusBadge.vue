<template>
  <span
    class="status-badge inline-flex items-center rounded-full border font-medium"
    :class="[data.cls, sizeCls]"
    :data-pulse="data.pulse"
    :title="data.tip || undefined"
    :aria-label="data.tip || data.label"
  >
    <span class="relative inline-flex shrink-0" :class="dotSize">
      <span v-if="data.pulse" class="status-badge-pulse absolute inset-0 rounded-full" :class="data.dot"></span>
      <span class="relative inline-flex rounded-full" :class="[data.dot, dotSize]" :style="glowStyle"></span>
    </span>
    <span v-if="showLabel" class="truncate">{{ data.label }}</span>
  </span>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  status: { type: String, default: '' },
  size: { type: String, default: 'sm', validator: (v) => ['sm', 'md'].includes(v) },
  showLabel: { type: Boolean, default: true },
});

const STATUS = {
  running: { label: '运行中', dot: 'bg-emerald-400', pulse: true, glow: 'rgba(52, 211, 153, 0.5)', cls: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10', tip: '服务运行正常' },
  restarting: { label: '重启中', dot: 'bg-amber-400', pulse: true, glow: 'rgba(251, 191, 36, 0.5)', cls: 'text-amber-300 border-amber-500/30 bg-amber-500/10', tip: '服务正在重启' },
  paused: { label: '已暂停', dot: 'bg-sky-400', pulse: false, glow: '', cls: 'text-sky-300 border-sky-500/30 bg-sky-500/10', tip: '服务已暂停' },
  stopped: { label: '已停止', dot: 'bg-surface-500', pulse: false, glow: '', cls: 'text-surface-500 border-surface-600/40 bg-surface-800/40', tip: '服务已停止' },
  partial: { label: '部分异常', dot: 'bg-amber-400', pulse: false, glow: 'rgba(251, 191, 36, 0.45)', cls: 'text-amber-300 border-amber-500/30 bg-amber-500/10', tip: '部分容器未正常运行' },
  degraded: { label: '运行降级', dot: 'bg-rose-400', pulse: false, glow: 'rgba(251, 113, 133, 0.5)', cls: 'text-rose-300 border-rose-500/30 bg-rose-500/10', tip: '服务质量已降级,请检查' },
  error: { label: '异常', dot: 'bg-rose-400', pulse: false, glow: 'rgba(251, 113, 133, 0.55)', cls: 'text-rose-300 border-rose-500/40 bg-rose-500/10', tip: '运行异常,请检查日志' },
  queued: { label: '排队中', dot: 'bg-accent', pulse: true, glow: 'rgba(37, 99, 235, 0.5)', cls: 'text-blue-300 border-blue-500/30 bg-blue-500/10', tip: '任务已创建,等待执行' },
  task: { label: '执行中', dot: 'bg-accent', pulse: true, glow: 'rgba(37, 99, 235, 0.5)', cls: 'text-blue-300 border-blue-500/30 bg-blue-500/10', tip: '任务正在执行' },
  pending: { label: '等待', dot: 'bg-surface-500', pulse: false, glow: '', cls: 'text-surface-400 border-surface-600/40 bg-surface-800/40', tip: '等待执行' },
  success: { label: '成功', dot: 'bg-emerald-400', pulse: false, glow: 'rgba(52, 211, 153, 0.35)', cls: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10', tip: '执行成功' },
  failed: { label: '失败', dot: 'bg-rose-400', pulse: false, glow: 'rgba(251, 113, 133, 0.45)', cls: 'text-rose-300 border-rose-500/40 bg-rose-500/10', tip: '执行失败,请查看详情' },
  interrupted: { label: '已中断', dot: 'bg-amber-400', pulse: false, glow: '', cls: 'text-amber-300 border-amber-500/30 bg-amber-500/10', tip: '任务被中断' },
};

const data = computed(() => STATUS[props.status] || { label: props.status || '未知', dot: 'bg-surface-600', pulse: false, glow: '', cls: 'text-surface-400 border-surface-600/40 bg-surface-800/40', tip: '未知状态' });
const sizeCls = computed(() => (props.size === 'md' ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-[11px]'));
const dotSize = computed(() => (props.size === 'md' ? 'h-2.5 w-2.5' : 'h-2 w-2'));
const glowStyle = computed(() => (data.value.glow && !data.value.pulse ? { boxShadow: `0 0 8px ${data.value.glow}` } : undefined));
</script>
