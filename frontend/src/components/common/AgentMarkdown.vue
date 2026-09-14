<template>
  <div ref="rootEl" v-bind="$attrs"></div>
</template>

<script setup>
import { watch, onMounted, ref } from 'vue';
import { renderAgentMarkdown } from '../../lib/agent-markdown.js';

const props = defineProps({ content: String });
const rootEl = ref(null);

function addCopyButtons() {
  if (!rootEl.value) return;
  const pres = rootEl.value.querySelectorAll('pre');
  pres.forEach((pre) => {
    if (pre.querySelector('.code-copy-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'code-copy-btn';
    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
    btn.title = '复制代码';
    btn.onclick = () => {
      const code = pre.querySelector('code')?.textContent || pre.textContent;
      navigator.clipboard.writeText(code).then(() => {
        btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        setTimeout(() => {
          btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
        }, 1500);
      });
    };
    pre.style.position = 'relative';
    pre.appendChild(btn);
  });
}

watch(() => props.content, () => {
  if (rootEl.value) {
    rootEl.value.innerHTML = renderAgentMarkdown(props.content || '');
    setTimeout(addCopyButtons, 0);
  }
}, { immediate: true });

onMounted(() => {
  if (rootEl.value) {
    rootEl.value.innerHTML = renderAgentMarkdown(props.content || '');
    setTimeout(addCopyButtons, 0);
  }
});
</script>
