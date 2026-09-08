<template>
  <div v-if="visible"
       class="chart-tooltip"
       :style="{ left: `${x}px`, top: `${y}px` }">
    <template v-if="multi && datasets.length > 0">
      <div class="tooltip-time">{{ formatTime(datasets[0].visibleData[hoverIndex]?.timestamp) }}</div>
      <div v-for="(dataset, idx) in datasets" :key="`tooltip-${idx}`"
           v-if="dataset.visibleData[hoverIndex]"
           class="tooltip-metric">
        <span class="tooltip-metric-dot" :style="{ backgroundColor: dataset.color }"></span>
        <span class="tooltip-metric-label">{{ dataset.label }}:</span>
        <span class="tooltip-metric-value">{{ formatValue(dataset.visibleData[hoverIndex].value) }} {{ dataset.unit }}</span>
      </div>
    </template>
    <template v-else-if="point">
      <div class="tooltip-time">{{ formatTime(point.timestamp) }}</div>
      <div class="tooltip-value">{{ formatValue(point.value) }}</div>
    </template>
  </div>
</template>

<script setup>
defineProps({
  visible: { type: Boolean, default: false },
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
  multi: { type: Boolean, default: false },
  datasets: { type: Array, default: () => [] },
  hoverIndex: { type: Number, default: null },
  point: { type: Object, default: null },
  unit: { type: String, default: '' },
});

function formatValue(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  return `${value.toFixed(1)}${unit}`;
}
function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
</script>

<style scoped>
.chart-tooltip {
  position: absolute;
  background: #18181b;
  border: 1px solid #38BDF8;
  border-radius: 0.375rem;
  padding: 0.5rem 0.75rem;
  pointer-events: none;
  z-index: 10;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.tooltip-time {
  font-size: 0.75rem;
  color: #a1a1aa;
  margin-bottom: 0.25rem;
}

.tooltip-value {
  font-size: 0.875rem;
  font-weight: 600;
  color: #38BDF8;
}

.tooltip-metric {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.25rem;
  font-size: 0.875rem;
}

.tooltip-metric-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  flex-shrink: 0;
}

.tooltip-metric-label {
  color: #a1a1aa;
  font-weight: 500;
}

.tooltip-metric-value {
  color: #e4e4e7;
  font-weight: 600;
}
</style>

/**
 * ChartTooltip.vue —— 悬浮提示(单指标 / 多指标)。
 * 从 InteractiveChart.vue 拆分。
 */
