<template>
  <span v-if="links.length" class="relative inline-flex shrink-0">
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
      <button class="webui-badge" :title="`${links.length} 个 WebUI 端口,点击选择`" @click.stop="open = !open">
        <Globe class="w-3.5 h-3.5" />WebUI {{ links[0].port }}
        <ChevronDown class="w-3 h-3 transition-transform" :class="{ 'rotate-180': open }" />
      </button>
      <span v-if="open" class="webui-menu">
        <a v-for="link in links" :key="link.port" :href="link.url" target="_blank" rel="noopener noreferrer" class="webui-menu-item" @click="open = false">
          <Globe class="w-3.5 h-3.5 text-surface-400" />:{{ link.port }}<span class="text-muted ml-auto">{{ link.containerName }}</span>
        </a>
      </span>
    </template>
  </span>
</template>

<script setup>
import { ref } from 'vue';
import { ChevronDown, Globe } from 'lucide-vue-next';

defineProps({ links: { type: Array, default: () => [] } });
const open = ref(false);
</script>
