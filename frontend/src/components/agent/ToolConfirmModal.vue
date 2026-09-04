<template>
  <BaseModal
    :show="show"
    :title="`确认执行 · ${tool?.name || '未知工具'}`"
    size-class="sm:max-w-xl"
    body-class="p-4 space-y-3 max-h-[65vh] overflow-y-auto"
    @close="$emit('cancel')"
  >
    <div class="flex items-center gap-2">
      <RiskBadge :risk="tool?.risk || ''" size="md" />
      <span class="text-xs text-zinc-500">需要您的明确授权</span>
    </div>

    <p v-if="tool?.description" class="text-sm leading-relaxed text-zinc-300">{{ tool.description }}</p>

    <div v-if="hasParams" class="space-y-1.5">
      <div class="flex items-center justify-between">
        <label for="tool-params" class="text-xs font-medium text-zinc-400">参数(可直接编辑)</label>
        <button class="text-[10px] text-zinc-500 hover:text-cyan-300" @click="resetParams">还原原始参数</button>
      </div>
      <textarea
        id="tool-params"
        v-model="paramText"
        rows="6"
        class="input w-full resize-y font-mono text-xs leading-relaxed"
        spellcheck="false"
      ></textarea>
      <p v-if="parseError" class="text-xs text-rose-400">{{ parseError }}</p>
    </div>

    <div v-if="tool?.risk === 'critical'" class="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
      <div class="flex items-start gap-2">
        <AlertTriangle class="h-4 w-4 shrink-0 text-rose-400" />
        <div class="text-xs text-rose-300"><strong>重要提醒：</strong>此操作可能无法撤销，请仔细检查参数后再继续。</div>
      </div>
    </div>

    <template #footer>
      <button class="btn-ghost" @click="$emit('cancel')">取消</button>
      <button class="btn-primary" :disabled="!!parseError" @click="confirm">
        <Check class="h-4 w-4" />确认执行
      </button>
    </template>
  </BaseModal>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { AlertTriangle, Check } from 'lucide-vue-next';
import BaseModal from '../common/BaseModal.vue';
import RiskBadge from '../common/RiskBadge.vue';

const props = defineProps({
  show: { type: Boolean, default: false },
  tool: { type: Object, default: null }, // { name, description, risk, input }
});

// confirm 携带(可能被用户编辑过的)参数;无参数时为 null
const emit = defineEmits(['confirm', 'cancel']);

const paramText = ref('');

const hasParams = computed(() => !!props.tool?.input && Object.keys(props.tool.input).length > 0);

watch(() => props.show, (show) => {
  if (show) paramText.value = JSON.stringify(props.tool?.input ?? {}, null, 2);
});

const parseError = computed(() => {
  if (!hasParams.value) return '';
  try {
    const value = JSON.parse(paramText.value);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '参数必须是 JSON 对象';
    return '';
  } catch (e) {
    return `JSON 解析失败:${e.message}`;
  }
});

function resetParams() {
  paramText.value = JSON.stringify(props.tool?.input ?? {}, null, 2);
}

function confirm() {
  if (parseError.value) return;
  emit('confirm', hasParams.value ? JSON.parse(paramText.value) : null);
}
</script>
