<template>
  <div class="modal-backdrop z-[55]" @click.self="close">
    <div class="modal max-w-[calc(100vw-2rem)] sm:max-w-2xl flex max-h-[90vh] flex-col">
      <div class="modal-header shrink-0"><span class="flex items-center gap-2"><span class="grid h-7 w-7 place-items-center rounded-lg border border-surface-700 bg-surface-950/60"><component :is="iconFor" class="h-4 w-4 text-accent" /></span>部署 {{ blueprint.name }}</span><button class="icon-btn" title="关闭" @click="close"><X class="w-4 h-4" /></button></div>
      <div class="min-h-0 flex-1 overflow-y-auto p-4 space-y-3">
        <div class="form-grid">
          <label class="md:col-span-2">项目名称<input v-model="values.projectName" class="input" placeholder="如 my-uptime-kuma" /></label>
        </div>
        <div class="form-grid">
          <template v-for="field in blueprint.envSchema" :key="field.key">
            <label :class="field.secret ? 'md:col-span-2' : ''">{{ field.label }}<input v-model="values[field.key]" :type="field.secret ? 'password' : 'text'" class="input" :placeholder="field.default ? String(field.default) : field.secret ? '留空则注释' : ''" /></label>
          </template>
        </div>
        <details class="text-sm">
          <summary class="cursor-pointer text-surface-300">预览生成的 Compose 与 .env</summary>
          <pre class="mt-2 rounded-lg border border-surface-800 bg-black/40 p-3 font-mono text-[11px] text-surface-300 whitespace-pre-wrap">{{ previewCompose }}</pre>
          <pre class="mt-2 rounded-lg border border-surface-800 bg-black/40 p-3 font-mono text-[11px] text-emerald-300/80 whitespace-pre-wrap">{{ previewEnv }}</pre>
        </details>
        <p v-if="error" class="alert-error">{{ error }}</p>
      </div>
      <div class="flex shrink-0 items-center justify-end gap-2 border-t border-surface-800 p-3">
        <button class="btn-secondary" @click="close">取消</button>
        <button class="btn-primary" :disabled="deploying" @click="deploy"><Zap class="w-4 h-4" />{{ deploying ? '部署中…' : '立即部署' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useEscapeKey } from '../../composables/useEscapeKey.js';
import { api } from '../../api/client.js';
import { useToastStore } from '../../stores/toast.js';
import { X, Zap } from 'lucide-vue-next';
import blueprintIcon from '../../lib/blueprintIcons.js';

const props = defineProps({
  blueprint: { type: Object, required: true },
  open: { type: Boolean, default: true },
});
const emit = defineEmits(['close', 'deployed']);
const toast = useToastStore();
const deploying = ref(false);
const error = ref('');
const values = ref({});

const active = computed(() => props.open);
const iconFor = computed(() => blueprintIcon(props.blueprint.id));
const previewCompose = computed(() => {
  let compose = props.blueprint.defaultCompose;
  for (const field of props.blueprint.envSchema || []) {
    const value = values.value[field.key] ?? field.default ?? '';
    compose = compose.split(`\${${field.key}}`).join(String(value));
  }
  return compose;
});
const previewEnv = computed(() => {
  return (props.blueprint.envSchema || []).map((field) => {
    const value = values.value[field.key] ?? field.default ?? '';
    return value || !field.secret ? `${field.key}=${value}` : `# ${field.key}=(请填写)`;
  }).join('\n');
});

async function deploy() {
  if (deploying.value) return;
  error.value = '';
  const name = String(values.value.projectName || '').trim();
  if (!name) { error.value = '请填写项目名称'; return; }
  deploying.value = true;
  toast.info('开始部署,请查看输出面板');
  try {
    const payload = { ...values.value };
    delete payload.projectName;
    await api.streamBlueprintDeploy(props.blueprint.id, { ...payload, projectName: name }, (frame) => {
      if (frame.type === 'error') error.value = frame.data;
      if (frame.type === 'result' && frame.data.ok) {
        toast.success(`${props.blueprint.name} 部署完成`);
        emit('deployed', frame.data);
        close();
      } else if (frame.type === 'result' && !frame.data.ok) {
        error.value = frame.data.message || '部署失败';
      }
    });
  } catch (e) {
    error.value = e.message;
  } finally {
    deploying.value = false;
  }
}
function close() { if (!deploying.value) emit('close'); }
useEscapeKey({ active, onClose: close, layer: 'modal', lockBody: true });
</script>
