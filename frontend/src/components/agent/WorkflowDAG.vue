<template>
  <svg :viewBox="`0 0 ${width} ${height}`" class="w-full" :style="{ height: `${height}px` }">
    <defs>
      <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
        <polygon points="0 0, 8 4, 0 8" fill="currentColor" class="text-zinc-600" />
      </marker>
      <linearGradient id="edge-gradient-pending" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" style="stop-color: rgb(63 63 70); stop-opacity: 1" />
        <stop offset="100%" style="stop-color: rgb(63 63 70); stop-opacity: 0.3" />
      </linearGradient>
      <linearGradient id="edge-gradient-success" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" style="stop-color: rgb(16 185 129); stop-opacity: 1" />
        <stop offset="100%" style="stop-color: rgb(16 185 129); stop-opacity: 0.4" />
      </linearGradient>
      <linearGradient id="edge-gradient-failed" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" style="stop-color: rgb(244 63 94); stop-opacity: 1" />
        <stop offset="100%" style="stop-color: rgb(244 63 94); stop-opacity: 0.4" />
      </linearGradient>
    </defs>

    <!-- Edges -->
    <g v-for="edge in edges" :key="edge.id">
      <path
        :d="edge.path"
        fill="none"
        :stroke="edge.gradient"
        stroke-width="1.5"
        marker-end="url(#arrowhead)"
        :class="edge.class"
      />
    </g>

    <!-- Nodes -->
    <g v-for="node in nodes" :key="node.id" :transform="`translate(${node.x}, ${node.y})`">
      <rect
        :width="nodeWidth"
        :height="nodeHeight"
        :rx="8"
        :class="[
          'transition-all duration-200',
          node.status === 'success' ? 'fill-emerald-950/60 stroke-emerald-500' :
          node.status === 'failed' ? 'fill-rose-950/60 stroke-rose-500' :
          node.status === 'executing' ? 'fill-cyan-950/60 stroke-cyan-400' :
          'fill-zinc-900/80 stroke-zinc-700'
        ]"
        stroke-width="1.5"
      />
      
      <!-- Status indicator -->
      <circle
        :cx="12"
        :cy="nodeHeight / 2"
        r="4"
        :class="[
          node.status === 'success' ? 'fill-emerald-400' :
          node.status === 'failed' ? 'fill-rose-400' :
          node.status === 'executing' ? 'fill-cyan-400 animate-pulse' :
          'fill-zinc-600'
        ]"
      />

      <!-- Tool name -->
      <text
        :x="24"
        :y="nodeHeight / 2 - 8"
        class="fill-zinc-200 text-[11px] font-mono"
      >
        {{ truncate(node.tool, 18) }}
      </text>

      <!-- Duration or risk badge -->
      <text
        :x="24"
        :y="nodeHeight / 2 + 8"
        :class="[
          'text-[9px]',
          node.status === 'success' || node.status === 'failed' ? 'fill-zinc-500' :
          node.risk === 'high' || node.risk === 'critical' ? 'fill-rose-400' :
          'fill-zinc-600'
        ]"
      >
        {{ node.label }}
      </text>

      <!-- Confirmation icon -->
      <g v-if="node.confirmationRequired && node.status === 'pending'" :transform="`translate(${nodeWidth - 18}, ${nodeHeight / 2 - 6})`">
        <circle cx="6" cy="6" r="6" class="fill-amber-500/20" />
        <path d="M 6 3 L 6 7 M 6 9 L 6 9.5" stroke="currentColor" class="text-amber-400" stroke-width="1.2" stroke-linecap="round" />
      </g>
    </g>
  </svg>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  steps: { type: Array, default: () => [] },
  results: { type: Array, default: () => [] }
});

const nodeWidth = 180;
const nodeHeight = 56;
const horizontalGap = 60;
const verticalGap = 80;

const nodes = computed(() => {
  const resultMap = new Map((props.results || []).map((r, idx) => [idx, r]));
  
  return (props.steps || []).map((step, idx) => {
    const result = resultMap.get(idx);
    const status = result ? (result.status === 'success' ? 'success' : 'failed') : (idx === props.results?.length ? 'executing' : 'pending');
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    
    let label = '';
    if (status === 'success' || status === 'failed') {
      label = result?.durationMs ? `${result.durationMs}ms` : status;
    } else if (step.risk === 'high' || step.risk === 'critical') {
      label = step.risk === 'critical' ? '极高风险' : '高风险';
    } else if (step.confirmationRequired) {
      label = '需确认';
    }

    return {
      id: `node-${idx}`,
      tool: step.tool,
      status,
      risk: step.risk,
      confirmationRequired: step.confirmationRequired,
      label,
      x: col * (nodeWidth + horizontalGap) + 20,
      y: row * (nodeHeight + verticalGap) + 20
    };
  });
});

const edges = computed(() => {
  const result = [];
  for (let i = 0; i < nodes.value.length - 1; i++) {
    const from = nodes.value[i];
    const to = nodes.value[i + 1];
    
    const fromX = from.x + nodeWidth;
    const fromY = from.y + nodeHeight / 2;
    const toX = to.x;
    const toY = to.y + nodeHeight / 2;

    let path, gradient, edgeClass;
    if (to.y === from.y) {
      // Same row: straight horizontal line
      path = `M ${fromX} ${fromY} L ${toX} ${toY}`;
    } else {
      // Different rows: curved path
      const midX = fromX + (toX - fromX) / 2;
      path = `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`;
    }

    if (from.status === 'success' && (to.status === 'success' || to.status === 'executing')) {
      gradient = 'url(#edge-gradient-success)';
      edgeClass = 'opacity-100';
    } else if (from.status === 'failed') {
      gradient = 'url(#edge-gradient-failed)';
      edgeClass = 'opacity-100';
    } else {
      gradient = 'url(#edge-gradient-pending)';
      edgeClass = 'opacity-50';
    }

    result.push({
      id: `edge-${i}`,
      path,
      gradient,
      class: edgeClass
    });
  }
  return result;
});

const width = computed(() => {
  const cols = Math.min(3, nodes.value.length);
  return cols * nodeWidth + (cols - 1) * horizontalGap + 40;
});

const height = computed(() => {
  const rows = Math.ceil(nodes.value.length / 3);
  return rows * nodeHeight + (rows - 1) * verticalGap + 40;
});

function truncate(str, maxLen) {
  return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
}
</script>
