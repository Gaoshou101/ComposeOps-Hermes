<template>
  <!-- 展开时抬高整个 launcher 的层级:菜单绝对定位在卡片流之外,若不抬高,
       DOM 中在后面的兄弟卡片会盖住它(同层后来者胜)。 -->
  <span v-if="links.length" ref="rootEl" class="relative inline-flex shrink-0" :class="{ 'z-30': open }">
    <a
      v-if="links.length === 1"
      :href="links[0].url"
      target="_blank"
      rel="noopener noreferrer"
      class="webui-badge"
      :title="`打开 WebUI (${links[0].url})`"
    >
      <Globe class="w-3.5 h-3.5" />WebUI {{ links[0].port }}
    </a>
    <template v-else>
      <button
        class="webui-badge"
        :title="`${links.length} 个 WebUI 端口,点击选择`"
        :aria-expanded="open"
        aria-haspopup="menu"
        @click.stop="open = !open"
      >
        <Globe class="w-3.5 h-3.5" />WebUI · {{ links.length }}
        <ChevronDown class="w-3 h-3 transition-transform" :class="{ 'rotate-180': open }" />
      </button>
      <span v-if="open" class="webui-menu" role="menu">
        <a v-for="link in links" :key="link.port" :href="link.url" target="_blank" rel="noopener noreferrer" class="webui-menu-item" role="menuitem" @click="open = false">
          <Globe class="w-3.5 h-3.5 text-surface-400" />:{{ link.port }}<span class="text-muted ml-auto">{{ link.containerName }}</span>
        </a>
      </span>
    </template>
  </span>
</template>

<script setup>
import { onBeforeUnmount, ref, watch } from 'vue';
import { ChevronDown, Globe } from 'lucide-vue-next';
import { useEscapeKey } from '../../composables/useEscapeKey.js';

defineProps({ links: { type: Array, default: () => [] } });
const open = ref(false);
const rootEl = ref(null);

useEscapeKey({ active: open, onClose: () => { open.value = false; }, layer: 'command' });

// 点击菜单外部关闭。只在展开期间挂监听,避免每张卡片常驻一个全局 handler;
// 用捕获阶段是为了在按钮自身的 @click.stop 之前就拿到事件。
function onDocumentPointerDown(event) {
  if (!rootEl.value?.contains(event.target)) open.value = false;
}
watch(open, (isOpen) => {
  if (isOpen) document.addEventListener('pointerdown', onDocumentPointerDown, true);
  else document.removeEventListener('pointerdown', onDocumentPointerDown, true);
});
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointerDown, true));
</script>
