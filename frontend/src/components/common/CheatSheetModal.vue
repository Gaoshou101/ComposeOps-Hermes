<template>
  <div v-if="open" class="modal-backdrop z-[60]" @click.self="close">
    <div class="modal max-w-[calc(100vw-2rem)] sm:max-w-xl flex max-h-[85vh] flex-col">
      <div class="modal-header shrink-0"><span class="flex items-center gap-2"><Keyboard class="w-4 h-4 text-accent" />快捷键速查表</span><button class="icon-btn" title="关闭" @click="close"><X class="w-4 h-4" /></button></div>
      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <div class="grid gap-4 sm:grid-cols-2">
          <div v-for="(group, gi) in groups" :key="gi">
            <p class="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-surface-500">{{ group.label }}</p>
            <div v-for="(item, ii) in group.items" :key="ii" class="flex items-center justify-between gap-3 py-1 text-sm">
              <span class="text-surface-300">{{ item.label }}</span>
              <span class="flex flex-wrap justify-end gap-1"><kbd v-for="(key, ki) in item.keys" :key="ki" class="shortcut-key">{{ key }}</kbd></span>
            </div>
          </div>
        </div>
        <div class="mt-4 border-t border-surface-800 pt-3 text-xs text-muted">
          <p>输入框 / 编辑器聚焦时自动禁用快捷键,避免打字冲突。`?` / Esc 可随时打开或关闭本速查表。</p>
        </div>
      </div>
      <div class="flex shrink-0 items-center justify-end border-t border-surface-800 p-3">
        <button class="btn-secondary" @click="close">关闭</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useEscapeKey } from '../../composables/useEscapeKey.js';
import { computed } from 'vue';
import { Keyboard, X } from 'lucide-vue-next';
const props = defineProps({ open: { type: Boolean, default: false } });
const emit = defineEmits(['close']);
const active = computed(() => props.open);
function close() { emit('close'); }
useEscapeKey({ active, onClose: close, layer: 'command' });

const groups = [
  { label: '服务列表导航', items: [
    { label: '移动到上一个/下一个项目', keys: ['j', '↓'] },
    { label: '展开 / 折叠当前项目', keys: ['o', 'Enter'] },
    { label: '查看当前项目日志', keys: ['l'] },
    { label: '编辑环境变量', keys: ['e'] },
    { label: '进入 Compose 编辑器', keys: ['c'] },
    { label: '快速重启(带确认)', keys: ['r'] },
    { label: '打开 WebUI(新标签页)', keys: ['w'] },
  ]},
  { label: '全局', items: [
    { label: '打开快捷跳转 (Cmd+K)', keys: ['Ctrl', 'K'] },
    { label: '快捷键速查表', keys: ['?'] },
    { label: '关闭弹层 / 对话框', keys: ['Esc'] },
  ]},
  { label: '日志页面', items: [
    { label: '暂停 / 继续显示', keys: ['Space'] },
    { label: '恢复自动滚动', keys: ['End'] },
  ]},
];
</script>
