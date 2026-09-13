<template>
  <div ref="root" v-bind="$attrs"></div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { renderAgentMarkdown } from '../../lib/agent-markdown.js';

const props = defineProps({
  content: { type: String, default: '' },
  html: { type: String, default: '' },
});

const rendered = computed(() => props.html || renderAgentMarkdown(props.content));
const root = ref(null);
watch(rendered, (value) => {
  if (root.value) root.value.innerHTML = value;
}, { immediate: true });
onMounted(() => {
  root.value.innerHTML = rendered.value;
});
</script>
