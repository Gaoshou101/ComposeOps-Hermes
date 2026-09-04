<template>
  <BaseModal
    :show="show"
    title="自定义预设与快捷工具"
    size-class="sm:max-w-3xl"
    body-class="p-4 space-y-4 max-h-[70vh] overflow-y-auto"
    @close="$emit('close')"
  >
    <div class="space-y-4">
      <!-- 预设文本 -->
      <div>
        <div class="mb-2 flex items-center justify-between">
          <label class="text-sm font-medium text-zinc-300">预设提示词</label>
          <button class="text-xs text-zinc-500 hover:text-cyan-300" @click="resetPresets">恢复默认</button>
        </div>
        <p class="mb-2 text-xs text-zinc-500">空页面时显示的快捷按钮,每行一条,为空则跳过该行</p>
        <textarea
          v-model="presetsText"
          rows="6"
          class="input w-full resize-y font-mono text-xs"
          placeholder="重启 web 服务&#10;查看项目容器状态&#10;清理旧镜像和悬空卷"
        ></textarea>
      </div>

      <!-- 快捷工具 -->
      <div>
        <div class="mb-2 flex items-center justify-between">
          <label class="text-sm font-medium text-zinc-300">快捷工具</label>
          <button class="text-xs text-zinc-500 hover:text-cyan-300" @click="resetQuickTools">恢复默认</button>
        </div>
        <p class="mb-2 text-xs text-zinc-500">右侧面板的快速操作按钮,可调整显示文本和参数</p>
        <div class="space-y-2">
          <div
            v-for="(tool, idx) in quickToolsList"
            :key="idx"
            class="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-2"
          >
            <div class="grid flex-1 gap-2 sm:grid-cols-2">
              <input v-model="tool.label" class="input !py-1 text-xs" placeholder="显示文本" />
              <input v-model="tool.name" class="input !py-1 font-mono text-xs" placeholder="工具名称" />
              <textarea
                v-model="tool.paramsText"
                rows="2"
                class="input !py-1 font-mono text-xs sm:col-span-2"
                placeholder='参数 JSON (可选),如 {"tail": 100}'
              ></textarea>
            </div>
            <button class="icon-btn shrink-0" title="删除" @click="removeQuickTool(idx)"><X class="h-4 w-4" /></button>
          </div>
          <button class="btn-secondary w-full !py-1.5 !text-xs" @click="addQuickTool"><Plus class="h-3.5 w-3.5" />添加工具</button>
        </div>
      </div>

      <div v-if="parseError" class="rounded-lg border border-rose-500/30 bg-rose-500/5 p-2 text-xs text-rose-300">{{ parseError }}</div>
    </div>

    <template #footer>
      <button class="btn-ghost" @click="$emit('close')">取消</button>
      <button class="btn-primary" :disabled="!!parseError" @click="save">
        <Save class="h-4 w-4" />保存
      </button>
    </template>
  </BaseModal>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { Plus, Save, X } from 'lucide-vue-next';
import BaseModal from '../common/BaseModal.vue';

const props = defineProps({
  show: { type: Boolean, default: false },
  presets: { type: Array, default: () => [] },
  quickTools: { type: Array, default: () => [] },
});

const emit = defineEmits(['close', 'save']);

const presetsText = ref('');
const quickToolsList = ref([]);

watch(() => props.show, (show) => {
  if (show) {
    presetsText.value = props.presets.join('\n');
    quickToolsList.value = props.quickTools.map((t) => ({
      label: t.label,
      name: t.name,
      paramsText: Object.keys(t.params || {}).length ? JSON.stringify(t.params, null, 2) : '',
    }));
  }
});

const parseError = computed(() => {
  for (const tool of quickToolsList.value) {
    if (!tool.label.trim() || !tool.name.trim()) return '工具标签和名称不能为空';
    if (tool.paramsText.trim()) {
      try {
        const params = JSON.parse(tool.paramsText);
        if (typeof params !== 'object' || Array.isArray(params)) return '参数必须是 JSON 对象';
      } catch {
        return `工具 ${tool.label} 的参数 JSON 格式错误`;
      }
    }
  }
  return '';
});

function resetPresets() {
  presetsText.value = '重启 web 服务\n查看项目容器状态\n清理旧镜像和悬空卷\n校验 Compose 配置\n分析容器为什么异常退出';
}

function resetQuickTools() {
  quickToolsList.value = [
    { label: '容器状态', name: 'compose.ps', paramsText: '' },
    { label: '资源指标', name: 'metrics.query', paramsText: '' },
    { label: '镜像更新', name: 'maintenance.update', paramsText: '' },
    { label: '最近日志', name: 'compose.logs', paramsText: '{\n  "tail": 100\n}' },
  ];
}

function addQuickTool() {
  quickToolsList.value.push({ label: '', name: '', paramsText: '' });
}

function removeQuickTool(idx) {
  quickToolsList.value.splice(idx, 1);
}

function save() {
  if (parseError.value) return;
  
  const presets = presetsText.value.split('\n').map((line) => line.trim()).filter(Boolean);
  const quickTools = quickToolsList.value.map((t) => {
    const params = t.paramsText.trim() ? JSON.parse(t.paramsText) : {};
    return { label: t.label.trim(), name: t.name.trim(), params };
  });
  
  emit('save', { presets, quickTools });
}
</script>
