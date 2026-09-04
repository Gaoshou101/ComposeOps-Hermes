<template>
  <BaseModal
    :show="show"
    :title="`步骤详情 · ${step?.tool || '未知工具'}`"
    size-class="sm:max-w-3xl"
    body-class="p-4 space-y-4 max-h-[70vh] overflow-y-auto"
    @close="$emit('close')"
  >
    <div class="flex items-center gap-2">
      <span class="count-badge">{{ step?.index + 1 }}</span>
      <RiskBadge v-if="step?.risk" :risk="step.risk" size="sm" />
      <span class="rounded-md border border-zinc-700 bg-zinc-800/40 px-2 py-0.5 text-xs font-medium" :class="statusClass">
        {{ statusLabel }}
      </span>
    </div>

    <div v-if="step?.params && Object.keys(step.params).length" class="space-y-1.5">
      <label class="text-xs font-medium text-zinc-400">输入参数</label>
      <pre class="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-xs leading-relaxed text-zinc-300 overflow-x-auto">{{ formatJSON(step.params) }}</pre>
    </div>

    <div v-if="step?.result" class="space-y-1.5">
      <label class="text-xs font-medium text-zinc-400">执行结果</label>
      <div class="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 space-y-2">
        <div v-if="step.result.durationMs" class="flex items-center gap-2 text-xs text-zinc-500">
          <Clock class="h-3.5 w-3.5" />
          <span>耗时: {{ step.result.durationMs }}ms</span>
        </div>
        <pre v-if="step.result.output" class="text-xs leading-relaxed text-zinc-300 overflow-x-auto">{{ step.result.output }}</pre>
        <p v-else-if="step.result.error" class="text-xs text-rose-400">{{ step.result.error }}</p>
        <p v-else class="text-xs text-zinc-500">无输出</p>
      </div>
    </div>

    <div v-if="step?.confirmationRequired && step.status === 'pending'" class="rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
      <p class="leading-relaxed">此步骤需要用户明确确认后才会执行</p>
    </div>

    <template #footer>
      <button class="btn-ghost !py-1.5" @click="$emit('close')">关闭</button>
    </template>
  </BaseModal>
</template>

<script setup>
import { computed } from 'vue';
import { Clock } from 'lucide-vue-next';
import BaseModal from '../common/BaseModal.vue';
import RiskBadge from '../common/RiskBadge.vue';

const props = defineProps({
  show: { type: Boolean, default: false },
  step: { type: Object, default: null }
});

defineEmits(['close']);

const statusLabel = computed(() => {
  const map = { success: '已成功', failed: '已失败', executing: '执行中', pending: '待执行' };
  return map[props.step?.status] || '未知';
});

const statusClass = computed(() => {
  const map = {
    success: 'text-emerald-300',
    failed: 'text-rose-300',
    executing: 'text-cyan-300',
    pending: 'text-zinc-400'
  };
  return map[props.step?.status] || 'text-zinc-400';
});

function formatJSON(obj) {
  return JSON.stringify(obj, null, 2);
}
</script>
