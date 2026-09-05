<template>
  <div class="modal-backdrop z-[55]" @click.self="$emit('close')">
    <div class="modal max-w-[calc(100vw-2rem)] sm:max-w-2xl">
      <div class="modal-header">
        <span>配置模板变量</span>
        <button class="icon-btn" @click="$emit('close')"><X class="w-4 h-4" /></button>
      </div>
      <div class="p-4 space-y-4 max-h-[70vh] overflow-auto">
        <div v-if="template.description" class="text-sm text-surface-300 pb-3 border-b border-surface-800">
          {{ template.description }}
        </div>
        <div v-for="variable in variables" :key="variable.name" class="space-y-1.5">
          <label class="block text-sm font-medium text-surface-200">
            {{ variable.label || variable.name }}
            <span v-if="variable.required" class="text-rose-400">*</span>
          </label>
          <input
            v-model="values[variable.name]"
            :type="variable.type === 'password' ? 'password' : 'text'"
            :placeholder="variable.default || variable.placeholder || `请输入 ${variable.label || variable.name}`"
            class="input w-full"
          />
          <p v-if="variable.description" class="text-xs text-surface-400">{{ variable.description }}</p>
        </div>
      </div>
      <footer class="flex items-center justify-end gap-2 border-t border-surface-800 px-4 py-2.5">
        <button class="btn-ghost" @click="$emit('close')">取消</button>
        <button class="btn-primary" :disabled="!isValid" @click="confirm">
          <Check class="w-4 h-4" />确认
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { Check, X } from 'lucide-vue-next';

const props = defineProps({
  template: { type: Object, required: true },
});

const emit = defineEmits(['close', 'confirm']);

const variables = computed(() => {
  if (!props.template.variables) return [];
  return Array.isArray(props.template.variables) 
    ? props.template.variables 
    : Object.entries(props.template.variables).map(([name, config]) => ({
        name,
        ...config,
      }));
});

const values = ref({});

// 初始化默认值
variables.value.forEach((v) => {
  if (v.default) values.value[v.name] = v.default;
});

const isValid = computed(() => {
  return variables.value
    .filter((v) => v.required)
    .every((v) => values.value[v.name]?.trim());
});

function confirm() {
  if (!isValid.value) return;
  emit('confirm', { ...values.value });
}
</script>
