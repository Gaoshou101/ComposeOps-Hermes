<template>
  <div class="interactive-chart-wrapper" ref="wrapperRef">
    <!-- Chart Toolbar -->
    <div class="chart-toolbar">
      <div class="chart-controls">
        <button v-for="type in chartTypes" :key="type.key"
                @click="chartType = type.key"
                :class="['chart-type-btn', chartType === type.key && 'active']"
                :title="type.label">
          <component :is="type.icon" class="w-4 h-4" />
        </button>
      </div>
      <div class="chart-stats">
        <span class="stat-item">最小: <strong>{{ stats.min }}</strong></span>
        <span class="stat-item">平均: <strong>{{ stats.avg }}</strong></span>
        <span class="stat-item">最大: <strong>{{ stats.max }}</strong></span>
        <span class="stat-item current">当前: <strong>{{ stats.current }}</strong></span>
      </div>
    </div>

    <!-- Main Chart Canvas -->
    <div class="chart-canvas-wrapper" ref="canvasWrapper">
      <svg :viewBox="`0 0 ${width} ${height}`" class="chart-canvas"
           @mousedown="onMouseDown"
           @mousemove="onMouseMove"
           @mouseleave="onMouseLeave"
           @wheel.prevent="onWheel">
        <defs>
          <!-- Area gradient -->
          <linearGradient :id="gradientId" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" :stop-color="color" stop-opacity="0.3" />
            <stop offset="100%" :stop-color="color" stop-opacity="0.05" />
          </linearGradient>
          
          <!-- Anomaly pattern -->
          <pattern id="anomaly-pattern" patternUnits="userSpaceOnUse" width="8" height="8">
            <rect width="8" height="8" fill="#DC2626" opacity="0.1" />
            <path d="M0 8 L8 0 M-2 2 L2 -2 M6 10 L10 6" stroke="#DC2626" stroke-width="1" opacity="0.3" />
          </pattern>
        </defs>

        <!-- Grid lines -->
        <g class="grid">
          <line v-for="i in gridLines" :key="`h-${i}`"
                :x1="padding.left" :y1="padding.top + plotHeight * i / gridLines"
                :x2="width - padding.right" :y2="padding.top + plotHeight * i / gridLines"
                class="grid-line" />
          <line v-for="i in Math.min(visiblePoints.length, 10)" :key="`v-${i}`"
                :x1="padding.left + plotWidth * i / Math.min(visiblePoints.length - 1, 10)" :y1="padding.top"
                :x2="padding.left + plotWidth * i / Math.min(visiblePoints.length - 1, 10)" :y2="height - padding.bottom"
                class="grid-line" />
        </g>

        <!-- Anomaly bands (behind chart) -->
        <g v-if="anomalies.length > 0" class="anomaly-bands">
          <rect v-for="(anomaly, idx) in visibleAnomalies" :key="`anomaly-${idx}`"
                :x="anomaly.x" :y="padding.top"
                :width="anomaly.width" :height="plotHeight"
                fill="url(#anomaly-pattern)" />
        </g>

        <!-- Area chart -->
        <path v-if="chartType === 'area' && areaPath"
              :d="areaPath"
              :fill="`url(#${gradientId})`"
              class="chart-area" />

        <!-- Line chart -->
        <path v-if="(chartType === 'line' || chartType === 'area') && linePath"
              :d="linePath"
              fill="none"
              :stroke="color"
              stroke-width="2"
              stroke-linejoin="round"
              stroke-linecap="round"
              class="chart-line" />

        <!-- Bar chart -->
        <g v-if="chartType === 'bar'">
          <rect v-for="(point, idx) in visiblePoints" :key="`bar-${idx}`"
                :x="getX(idx) - barWidth / 2"
                :y="getY(point.value)"
                :width="barWidth"
                :height="Math.max(0, height - padding.bottom - getY(point.value))"
                :fill="color"
                opacity="0.8"
                class="chart-bar" />
        </g>

        <!-- Hover crosshair -->
        <g v-if="hoverIndex !== null" class="crosshair">
          <line :x1="getX(hoverIndex)" :y1="padding.top"
                :x2="getX(hoverIndex)" :y2="height - padding.bottom"
                class="crosshair-line" />
          <circle :cx="getX(hoverIndex)" :cy="getY(visiblePoints[hoverIndex].value)"
                  r="4" :fill="color" class="crosshair-dot" />
        </g>

        <!-- Zoom selection -->
        <rect v-if="isDragging && dragStart && dragEnd"
              :x="Math.min(dragStart.x, dragEnd.x)" :y="padding.top"
              :width="Math.abs(dragEnd.x - dragStart.x)" :height="plotHeight"
              fill="#3B82F6" opacity="0.2" stroke="#3B82F6" stroke-width="1" />
      </svg>

      <!-- Hover tooltip -->
      <div v-if="hoverIndex !== null && visiblePoints[hoverIndex]"
           class="chart-tooltip"
           :style="{ left: `${tooltipX}px`, top: `${tooltipY}px` }">
        <div class="tooltip-time">{{ formatTime(visiblePoints[hoverIndex].timestamp) }}</div>
        <div class="tooltip-value">{{ formatValue(visiblePoints[hoverIndex].value) }}</div>
      </div>
    </div>

    <!-- Zoom controls -->
    <div class="zoom-controls">
      <button @click="zoomIn" class="zoom-btn" title="放大">
        <ZoomIn class="w-4 h-4" />
      </button>
      <button @click="zoomOut" class="zoom-btn" title="缩小">
        <ZoomOut class="w-4 h-4" />
      </button>
      <button @click="resetZoom" class="zoom-btn" title="重置">
        <Maximize2 class="w-4 h-4" />
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { TrendingUp, BarChart3, Activity, ZoomIn, ZoomOut, Maximize2 } from 'lucide-vue-next';

const props = defineProps({
  data: { type: Array, default: () => [] }, // [{ timestamp, value }]
  color: { type: String, default: '#38BDF8' },
  unit: { type: String, default: '' },
  anomalies: { type: Array, default: () => [] }, // [{ start, end }] timestamps
  width: { type: Number, default: 800 },
  height: { type: Number, default: 300 },
});

const chartTypes = [
  { key: 'line', label: '折线图', icon: TrendingUp },
  { key: 'area', label: '面积图', icon: Activity },
  { key: 'bar', label: '柱状图', icon: BarChart3 },
];

const chartType = ref('area');
const padding = { top: 20, right: 20, bottom: 30, left: 50 };
const gridLines = 5;
const gradientId = `chart-grad-${Math.random().toString(36).slice(2, 8)}`;

// Zoom and pan state
const zoomLevel = ref(1);
const panOffset = ref(0);
const maxZoom = 20;
const minZoom = 1;

// Interaction state
const hoverIndex = ref(null);
const isDragging = ref(false);
const dragStart = ref(null);
const dragEnd = ref(null);
const wrapperRef = ref(null);
const canvasWrapper = ref(null);

const plotWidth = computed(() => props.width - padding.left - padding.right);
const plotHeight = computed(() => props.height - padding.top - padding.bottom);

// Visible data range based on zoom and pan
const visiblePoints = computed(() => {
  if (props.data.length === 0) return [];
  const totalPoints = props.data.length;
  const visibleCount = Math.ceil(totalPoints / zoomLevel.value);
  const startIdx = Math.max(0, Math.min(totalPoints - visibleCount, Math.floor(panOffset.value)));
  const endIdx = Math.min(totalPoints, startIdx + visibleCount);
  return props.data.slice(startIdx, endIdx);
});

// Statistics
const stats = computed(() => {
  if (visiblePoints.value.length === 0) {
    return { min: '-', avg: '-', max: '-', current: '-' };
  }
  const values = visiblePoints.value.map(p => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
  const current = values[values.length - 1];
  
  return {
    min: formatValue(min),
    avg: formatValue(avg),
    max: formatValue(max),
    current: formatValue(current),
  };
});

// Y-axis scale
const yScale = computed(() => {
  if (visiblePoints.value.length === 0) return { min: 0, max: 100 };
  const values = visiblePoints.value.map(p => p.value);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const range = max - min;
  return {
    min: min - range * 0.1,
    max: max + range * 0.1,
  };
});

// Chart paths
const linePath = computed(() => {
  if (visiblePoints.value.length < 2) return '';
  return visiblePoints.value.map((point, i) => {
    const x = getX(i);
    const y = getY(point.value);
    return `${i === 0 ? 'M' : 'L'}${x},${y}`;
  }).join(' ');
});

const areaPath = computed(() => {
  if (!linePath.value) return '';
  const lastX = getX(visiblePoints.value.length - 1);
  const bottomY = props.height - padding.bottom;
  return `${linePath.value} L${lastX},${bottomY} L${padding.left},${bottomY} Z`;
});

const barWidth = computed(() => {
  if (visiblePoints.value.length === 0) return 0;
  return Math.max(2, Math.min(20, plotWidth.value / visiblePoints.value.length * 0.8));
});

// Visible anomalies
const visibleAnomalies = computed(() => {
  if (props.anomalies.length === 0 || visiblePoints.value.length === 0) return [];
  const startTime = visiblePoints.value[0].timestamp;
  const endTime = visiblePoints.value[visiblePoints.value.length - 1].timestamp;
  
  return props.anomalies
    .filter(a => a.end >= startTime && a.start <= endTime)
    .map(a => {
      const startIdx = visiblePoints.value.findIndex(p => p.timestamp >= a.start);
      const endIdx = visiblePoints.value.findIndex(p => p.timestamp >= a.end);
      if (startIdx === -1) return null;
      const start = startIdx === -1 ? 0 : startIdx;
      const end = endIdx === -1 ? visiblePoints.value.length - 1 : endIdx;
      return {
        x: getX(start),
        width: getX(end) - getX(start),
      };
    })
    .filter(Boolean);
});

// Coordinate helpers
function getX(index) {
  if (visiblePoints.value.length <= 1) return padding.left;
  return padding.left + (plotWidth.value * index) / (visiblePoints.value.length - 1);
}

function getY(value) {
  const { min, max } = yScale.value;
  const range = max - min;
  if (range === 0) return props.height - padding.bottom;
  return padding.top + plotHeight.value * (1 - (value - min) / range);
}

// Tooltip position
const tooltipX = computed(() => {
  if (hoverIndex.value === null) return 0;
  const x = getX(hoverIndex.value);
  return Math.min(Math.max(x, 60), props.width - 120);
});

const tooltipY = computed(() => {
  if (hoverIndex.value === null) return 0;
  const y = getY(visiblePoints.value[hoverIndex.value].value);
  return y > props.height / 2 ? y - 60 : y + 20;
});

// Formatting
function formatValue(value) {
  if (typeof value !== 'number' || isNaN(value)) return '-';
  return `${value.toFixed(1)}${props.unit}`;
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Mouse interactions
function onMouseMove(event) {
  if (visiblePoints.value.length === 0) return;
  
  const rect = event.currentTarget.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  
  if (isDragging.value) {
    dragEnd.value = { x, y };
    return;
  }
  
  // Find closest point
  const relX = x - padding.left;
  if (relX < 0 || relX > plotWidth.value) {
    hoverIndex.value = null;
    return;
  }
  
  const index = Math.round((relX / plotWidth.value) * (visiblePoints.value.length - 1));
  hoverIndex.value = Math.max(0, Math.min(visiblePoints.value.length - 1, index));
}

function onMouseDown(event) {
  const rect = event.currentTarget.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  
  isDragging.value = true;
  dragStart.value = { x, y };
  dragEnd.value = { x, y };
}

function onMouseUp(event) {
  if (!isDragging.value || !dragStart.value || !dragEnd.value) {
    isDragging.value = false;
    dragStart.value = null;
    dragEnd.value = null;
    return;
  }
  
  const startX = Math.min(dragStart.value.x, dragEnd.value.x);
  const endX = Math.max(dragStart.value.x, dragEnd.value.x);
  const selectionWidth = endX - startX;
  
  // Only zoom if selection is meaningful
  if (selectionWidth > 20) {
    const startRatio = (startX - padding.left) / plotWidth.value;
    const endRatio = (endX - padding.left) / plotWidth.value;
    const newZoom = 1 / (endRatio - startRatio);
    
    if (newZoom >= minZoom && newZoom <= maxZoom) {
      zoomLevel.value = newZoom;
      panOffset.value = Math.floor(props.data.length * startRatio);
    }
  }
  
  isDragging.value = false;
  dragStart.value = null;
  dragEnd.value = null;
}

function onMouseLeave() {
  hoverIndex.value = null;
}

function onWheel(event) {
  const delta = event.deltaY;
  const factor = delta > 0 ? 0.9 : 1.1;
  const newZoom = Math.max(minZoom, Math.min(maxZoom, zoomLevel.value * factor));
  
  if (newZoom !== zoomLevel.value) {
    // Adjust pan to zoom towards mouse position
    const rect = event.currentTarget.getBoundingClientRect();
    const mouseX = event.clientX - rect.left - padding.left;
    const mouseRatio = mouseX / plotWidth.value;
    
    const oldVisibleCount = Math.ceil(props.data.length / zoomLevel.value);
    const newVisibleCount = Math.ceil(props.data.length / newZoom);
    const panAdjust = (oldVisibleCount - newVisibleCount) * mouseRatio;
    
    zoomLevel.value = newZoom;
    panOffset.value = Math.max(0, panOffset.value + panAdjust);
  }
}

function zoomIn() {
  zoomLevel.value = Math.min(maxZoom, zoomLevel.value * 1.5);
}

function zoomOut() {
  zoomLevel.value = Math.max(minZoom, zoomLevel.value / 1.5);
  if (zoomLevel.value === minZoom) panOffset.value = 0;
}

function resetZoom() {
  zoomLevel.value = minZoom;
  panOffset.value = 0;
}

// Mount/unmount
onMounted(() => {
  if (wrapperRef.value) {
    wrapperRef.value.addEventListener('mouseup', onMouseUp);
  }
});

onBeforeUnmount(() => {
  if (wrapperRef.value) {
    wrapperRef.value.removeEventListener('mouseup', onMouseUp);
  }
});

// Watch for data changes and reset zoom if needed
watch(() => props.data.length, () => {
  if (zoomLevel.value > minZoom) {
    const maxOffset = props.data.length - Math.ceil(props.data.length / zoomLevel.value);
    if (panOffset.value > maxOffset) {
      panOffset.value = Math.max(0, maxOffset);
    }
  }
});
</script>

<style scoped>
.interactive-chart-wrapper {
  position: relative;
  width: 100%;
  background: #0F131C;
  border-radius: 0.5rem;
  border: 1px solid #27272a;
  padding: 1rem;
}

.chart-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid #27272a;
}

.chart-controls {
  display: flex;
  gap: 0.5rem;
}

.chart-type-btn {
  padding: 0.5rem;
  border-radius: 0.375rem;
  background: #18181b;
  border: 1px solid #27272a;
  color: #a1a1aa;
  cursor: pointer;
  transition: all 0.2s;
}

.chart-type-btn:hover {
  background: #27272a;
  color: #e4e4e7;
}

.chart-type-btn.active {
  background: #38BDF8;
  border-color: #38BDF8;
  color: #fff;
}

.chart-stats {
  display: flex;
  gap: 1.5rem;
  font-size: 0.75rem;
}

.stat-item {
  color: #71717a;
}

.stat-item strong {
  color: #e4e4e7;
  font-weight: 600;
  margin-left: 0.25rem;
}

.stat-item.current strong {
  color: #38BDF8;
}

.chart-canvas-wrapper {
  position: relative;
  width: 100%;
  cursor: crosshair;
  user-select: none;
}

.chart-canvas {
  width: 100%;
  height: auto;
  display: block;
}

.grid-line {
  stroke: #27272a;
  stroke-width: 1;
}

.chart-area {
  pointer-events: none;
}

.chart-line {
  pointer-events: none;
  filter: drop-shadow(0 0 4px currentColor);
}

.chart-bar {
  transition: opacity 0.2s;
}

.chart-bar:hover {
  opacity: 1 !important;
}

.crosshair-line {
  stroke: #52525b;
  stroke-width: 1;
  stroke-dasharray: 4 2;
}

.crosshair-dot {
  stroke: #fff;
  stroke-width: 2;
  filter: drop-shadow(0 0 4px currentColor);
}

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

.zoom-controls {
  position: absolute;
  top: 4.5rem;
  right: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.zoom-btn {
  padding: 0.5rem;
  background: #18181b;
  border: 1px solid #27272a;
  border-radius: 0.375rem;
  color: #a1a1aa;
  cursor: pointer;
  transition: all 0.2s;
}

.zoom-btn:hover {
  background: #27272a;
  color: #e4e4e7;
  border-color: #38BDF8;
}
</style>
