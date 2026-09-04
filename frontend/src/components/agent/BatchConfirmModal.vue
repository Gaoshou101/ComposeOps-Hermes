<template>
  <BaseModal
    :show="show"
    title="批量确认高风险操作"
    size-class="sm:max-w-2xl"
    body-class="p-3 space-y-3 max-h-[65vh] overflow-y-auto"
    @close="$emit('cancel')"
  >
    <div class="rounded-lg border border-amber-900/40 bg-amber-950/20 px-2.5 py-2 text-xs sm:text-sm text-amber-300">
      <p class="leading-relaxed">以下操作涉及高风险修改（重启服务、删除资源等），请逐项确认后再执行。确认后将按顺序自动执行全部步骤。</p>
    </div>

    <div class="flex items-center gap-2 border-b border-zinc-800 pb-2">
      <input id="select-all" type="checkbox" :checked="allChecked" class="checkbox" @change="toggleAll" />
      <label for="select-all" class="cursor-pointer text-xs sm:text-sm font-medium text-zinc-300">全选 ({{ confirmedCount }} / {{ steps.length }})</label>
    </div>

    <div class="space-y-2">
      <div
        v-for="(step, idx) in steps"
        :key="idx"
        class="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5 transition-colors sm:p-3"
        :class="{ 'border-cyan-800/60 bg-cyan-950/20': step.confirmed }"
      >
        <div class="flex items-start gap-2 sm:gap-3">
          <input :id="`step-${idx}`" v-model="step.confirmed" type="checkbox" class="checkbox mt-0.5 shrink-0" />
          <label :for="`step-${idx}`" class="min-w-0 flex-1 cursor-pointer">
            <div class="mb-1 flex flex-wrap items-center gap-1.5 sm:gap-2">
              <span class="count-badge shrink-0 !text-[10px]">{{ idx + 1 }}</span>
              <code class="break-all font-mono text-xs font-semibold text-cyan-300 sm:text-sm">{{ step.tool }}</code>
              <RiskBadge v-if="step.risk" :risk="step.risk" size="xs" />
            </div>
            <p class="text-xs leading-relaxed text-zinc-500">{{ step.description || formatParams(step.params) }}</p>
          </label>
          <button
            v-if="step.params && Object.keys(step.params).length"
            class="shrink-0 text-[10px] text-zinc-500 hover:text-cyan-300"
            @click="toggleEdit(idx)"
          >
            {{ editingIdx === idx ? '收起参数' : '编辑参数' }}
          </button>
        </div>
        <div v-if="editingIdx === idx" class="mt-2 space-y-1.5">
          <textarea v-model="paramsText" rows="4" class="input w-full resize-y font-mono text-xs leading-relaxed" spellcheck="false"></textarea>
          <p v-if="parseError" class="text-xs text-rose-400">{{ parseError }}</p>
        </div>
      </div>
    </div>

    <template #footer>
      <p class="mr-auto text-xs text-zinc-500">已确认 {{ confirmedCount }} 项，未确认 {{ unconfirmedCount }} 项</p>
      <button class="btn-ghost !py-1.5" @click="$emit('cancel')">取消</button>
      <button class="btn-primary !py-1.5" :disabled="unconfirmedCount > 0 || !!parseError" @click="confirmAll">
        <CheckCircle2 class="h-4 w-4" />确认执行 ({{ confirmedCount }})
      </button>
    </template>
  </BaseModal>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { CheckCircle2 } from 'lucide-vue-next';
import BaseModal from '../common/BaseModal.vue';
import RiskBadge from '../common/RiskBadge.vue';

const props = defineProps({
  show: { type: Boolean, default: false },
  steps: { type: Array, default: () => [] },
});

const emit = defineEmits(['confirm', 'cancel']);

const editingIdx = ref(-1);
const paramsText = ref('');

watch(() => props.show, (show) => {
  if (show) { editingIdx.value = -1; paramsText.value = ''; }
});

const confirmedCount = computed(() => props.steps.filter((s) => s.confirmed).length);
const unconfirmedCount = computed(() => props.steps.length - confirmedCount.value);
const allChecked = computed(() => props.steps.length > 0 && confirmedCount.value === props.steps.length);

const parseError = computed(() => {
  if (editingIdx.value < 0) return '';
  try {
    const value = JSON.parse(paramsText.value);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '参数必须是 JSON 对象';
    return '';
  } catch (e) {
    return `JSON 解析失败:${e.message}`;
  }
});

function toggleAll(event) {
  const checked = event.target.checked;
  props.steps.forEach((step) => (step.confirmed = checked));
}

function toggleEdit(idx) {
  if (editingIdx.value === idx) { closeEdit(); return; }
  editingIdx.value = idx;
  paramsText.value = JSON.stringify(props.steps[idx]?.params ?? {}, null, 2);
}

function closeEdit() {
  // 解析失败时保留编辑现场,由确认按钮禁用兜底
  if (parseError.value) return;
  props.steps[editingIdx.value].params = JSON.parse(paramsText.value);
  editingIdx.value = -1;
}

function confirmAll() {
  if (editingIdx.value >= 0) closeEdit();
  if (parseError.value) return;
  emit('confirm', props.steps);
}

function formatParams(params) {
  if (!params || !Object.keys(params).length) return '无参数';
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : v}`)
    .join(' ');
}
</script>
