<template>
  <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" @click.self="$emit('cancel')">
    <div class="card w-full max-w-2xl max-h-[80vh] flex flex-col" @click.stop>
      <div class="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div class="flex items-center gap-2">
          <ShieldAlert class="h-5 w-5 text-amber-400" />
          <h3 class="text-base font-semibold text-zinc-100">批量确认高风险操作</h3>
        </div>
        <button class="text-zinc-500 hover:text-zinc-300" @click="$emit('cancel')"><X class="h-5 w-5" /></button>
      </div>

      <div class="flex-1 overflow-y-auto px-4 py-3">
        <div class="mb-3 rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-sm text-amber-300">
          <p class="leading-relaxed">以下操作涉及高风险修改（重启服务、删除资源等），请逐项确认后再执行。确认后将按顺序自动执行全部步骤。</p>
        </div>

        <div class="mb-3 flex items-center gap-2 border-b border-zinc-800 pb-2">
          <input id="select-all" type="checkbox" :checked="allChecked" class="checkbox" @change="toggleAll" />
          <label for="select-all" class="cursor-pointer text-sm font-medium text-zinc-300">全选 ({{ confirmedCount }} / {{ steps.length }})</label>
        </div>

        <div class="space-y-2">
          <div v-for="(step, idx) in steps" :key="idx" class="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 transition-colors" :class="{ 'border-cyan-800/60 bg-cyan-950/20': step.confirmed }">
            <input :id="`step-${idx}`" v-model="step.confirmed" type="checkbox" class="checkbox mt-0.5 shrink-0" />
            <div class="min-w-0 flex-1">
              <label :for="`step-${idx}`" class="block cursor-pointer">
                <div class="mb-1 flex items-center gap-2">
                  <span class="count-badge shrink-0 !text-[10px]">{{ idx + 1 }}</span>
                  <code class="font-mono text-sm font-semibold text-cyan-300">{{ step.tool }}</code>
                  <span v-if="step.risk" class="ml-auto inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px]" :class="riskClasses(step.risk)">
                    <AlertTriangle class="h-3 w-3" />{{ riskLabel(step.risk) }}
                  </span>
                </div>
                <p class="text-xs leading-relaxed text-zinc-500">{{ step.description || formatParams(step.params) }}</p>
              </label>
            </div>
          </div>
        </div>
      </div>

      <div class="flex items-center justify-between border-t border-zinc-800 px-4 py-3">
        <p class="text-xs text-zinc-500">已确认 {{ confirmedCount }} 项，未确认 {{ unconfirmedCount }} 项</p>
        <div class="flex gap-2">
          <button class="btn-secondary !py-1.5" @click="$emit('cancel')">取消</button>
          <button class="btn-primary !py-1.5" :disabled="unconfirmedCount > 0" @click="$emit('confirm', steps)">
            <CheckCircle2 class="h-4 w-4" />确认执行 ({{ confirmedCount }})
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { AlertTriangle, CheckCircle2, ShieldAlert, X } from 'lucide-vue-next';

const props = defineProps({
  show: { type: Boolean, required: true },
  steps: { type: Array, required: true },
});

defineEmits(['confirm', 'cancel']);

const confirmedCount = computed(() => props.steps.filter((s) => s.confirmed).length);
const unconfirmedCount = computed(() => props.steps.length - confirmedCount.value);
const allChecked = computed(() => confirmedCount.value === props.steps.length);

function toggleAll(event) {
  const checked = event.target.checked;
  props.steps.forEach((step) => (step.confirmed = checked));
}

function riskLabel(risk) {
  return { low: '低风险', medium: '中风险', high: '高风险', critical: '极高风险' }[risk] || '需确认';
}

function riskClasses(risk) {
  return {
    low: 'border-zinc-700 bg-zinc-800/40 text-zinc-400',
    medium: 'border-amber-900/50 bg-amber-950/40 text-amber-300',
    high: 'border-rose-900/50 bg-rose-950/40 text-rose-300',
    critical: 'border-rose-900/70 bg-rose-950/60 text-rose-200',
  }[risk] || 'border-zinc-700 bg-zinc-800/40 text-zinc-400';
}

function formatParams(params) {
  if (!params || !Object.keys(params).length) return '无参数';
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : v}`)
    .join(' ');
}
</script>
