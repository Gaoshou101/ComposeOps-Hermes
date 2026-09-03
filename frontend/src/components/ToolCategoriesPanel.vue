<template>
  <div class="tool-categories">
    <div class="mb-3 flex items-center justify-between">
      <h3 class="text-sm font-semibold text-zinc-300">工具分组</h3>
      <button v-if="expandedCategory" class="btn-secondary !px-2 !py-1 !text-xs" @click="collapseAll">
        <ChevronsUpDown class="h-3 w-3" />收起全部
      </button>
    </div>

    <div v-if="loading" class="space-y-2">
      <div v-for="i in 3" :key="i" class="h-10 animate-pulse rounded border border-zinc-800 bg-zinc-900/40"></div>
    </div>

    <div v-else-if="error" class="rounded border border-rose-500/20 bg-rose-500/5 p-3 text-sm text-rose-300">
      {{ error }}
    </div>

    <div v-else class="space-y-2">
      <div
        v-for="category in categories"
        :key="category.key"
        class="category-card"
        :class="{ 'category-expanded': expandedCategory === category.key }"
      >
        <button class="category-header" @click="toggleCategory(category.key)">
          <div class="flex items-center gap-2">
            <component :is="getCategoryIcon(category.icon)" :class="getCategoryColor(category.key)" class="h-4 w-4" />
            <span class="font-medium text-zinc-200">{{ category.label }}</span>
            <span class="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">{{ category.toolCount }}</span>
          </div>
          <div class="flex items-center gap-2">
            <span v-if="category.risk" :class="getRiskClass(category.risk)" class="risk-badge">{{ getRiskLabel(category.risk) }}</span>
            <ChevronDown
              :class="{ 'rotate-180': expandedCategory === category.key }"
              class="h-4 w-4 text-zinc-500 transition-transform"
            />
          </div>
        </button>

        <div v-if="expandedCategory === category.key" class="category-content">
          <p class="mb-3 text-xs text-zinc-400">{{ category.description }}</p>
          <div class="space-y-1.5">
            <button
              v-for="tool in category.tools"
              :key="tool.name"
              class="tool-item"
              :disabled="!tool.enabled || running === tool.name"
              @click="$emit('invoke', tool)"
            >
              <div class="flex flex-1 items-start gap-2">
                <component :is="getToolIcon(tool)" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" />
                <div class="min-w-0 flex-1 text-left">
                  <div class="flex items-center gap-1.5">
                    <span class="truncate font-mono text-xs text-zinc-300">{{ tool.name }}</span>
                    <span v-if="tool.confirmationRequired" class="shrink-0 text-[10px] text-amber-400">需确认</span>
                  </div>
                  <p class="mt-0.5 text-[10px] leading-tight text-zinc-500">{{ tool.description }}</p>
                </div>
              </div>
              <div class="flex shrink-0 items-center gap-1.5">
                <span v-if="!tool.enabled" class="text-[10px] text-zinc-600">需项目</span>
                <LoaderCircle v-if="running === tool.name" class="h-3.5 w-3.5 animate-spin text-cyan-400" />
                <Play v-else class="h-3.5 w-3.5 text-zinc-500 transition-colors hover:text-cyan-400" />
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { 
  ChevronDown, 
  ChevronsUpDown, 
  Play, 
  LoaderCircle,
  Power,
  FileEdit,
  Stethoscope,
  Wrench,
  Shield,
  Settings,
  Zap,
  AlertTriangle
} from 'lucide-vue-next';

const props = defineProps({
  tools: { type: Array, default: () => [] },
  categories: { type: Array, default: () => [] },
  projectSelected: { type: Boolean, default: false },
  running: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' }
});

defineEmits(['invoke']);

const expandedCategory = ref(null);

const categoryIconMap = {
  power: Power,
  'file-edit': FileEdit,
  stethoscope: Stethoscope,
  wrench: Wrench,
  shield: Shield,
  settings: Settings
};

const categoryColorMap = {
  lifecycle: 'text-emerald-400',
  config: 'text-amber-400',
  diagnostic: 'text-cyan-400',
  maintenance: 'text-rose-400',
  security: 'text-blue-400',
  advanced: 'text-purple-400'
};

function getCategoryIcon(iconName) {
  return categoryIconMap[iconName] || Settings;
}

function getCategoryColor(categoryKey) {
  return categoryColorMap[categoryKey] || 'text-zinc-400';
}

function getToolIcon(tool) {
  if (tool.confirmationRequired || tool.risk === 'high' || tool.risk === 'critical') {
    return AlertTriangle;
  }
  return Zap;
}

function getRiskLabel(risk) {
  const labels = { low: '低风险', medium: '中风险', high: '高风险', critical: '极高' };
  return labels[risk] || risk;
}

function getRiskClass(risk) {
  if (risk === 'critical') return 'bg-rose-500/20 text-rose-300';
  if (risk === 'high') return 'bg-orange-500/20 text-orange-300';
  if (risk === 'medium') return 'bg-amber-500/20 text-amber-300';
  return 'bg-blue-500/20 text-blue-300';
}

function toggleCategory(key) {
  expandedCategory.value = expandedCategory.value === key ? null : key;
}

function collapseAll() {
  expandedCategory.value = null;
}

watch(() => props.projectSelected, () => {
  // 项目切换时保持当前展开状态
});
</script>

<style scoped>
.category-card {
  @apply rounded-lg border border-zinc-800 bg-zinc-900/40 transition-all;
}

.category-card:hover {
  @apply border-zinc-700 bg-zinc-900/60;
}

.category-expanded {
  @apply border-zinc-700 bg-zinc-900/60;
}

.category-header {
  @apply flex w-full items-center justify-between p-3 text-left transition-colors;
}

.category-header:hover {
  @apply bg-zinc-800/30;
}

.category-content {
  @apply border-t border-zinc-800 p-3;
}

.tool-item {
  @apply flex w-full items-center gap-2 rounded border border-zinc-800 bg-zinc-950/60 p-2 text-left transition-all;
}

.tool-item:hover:not(:disabled) {
  @apply border-zinc-700 bg-zinc-900/80;
}

.tool-item:disabled {
  @apply cursor-not-allowed opacity-50;
}

.risk-badge {
  @apply rounded px-1.5 py-0.5 text-[10px] font-medium;
}
</style>
