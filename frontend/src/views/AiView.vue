<template>
  <div class="h-full flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <div class="mr-auto"><h1 class="page-title">AI 运维助手</h1><p class="page-subtitle">结合 Compose 配置和最近日志进行诊断</p></div>
      <select v-model="projectId" class="input" @change="containerId = ''"><option value="">选择项目</option><option v-for="p in projects" :key="p.id" :value="p.id">{{ p.projectName }}</option></select>
      <select v-model="containerId" class="input"><option value="">选择容器</option><option v-for="c in containers" :key="c.id" :value="c.id">{{ c.name }}</option></select>
      <button class="btn-secondary" :disabled="streaming || !containerId" @click="diagnose"><Stethoscope class="w-4 h-4" />诊断</button>
      <button class="icon-btn" title="重新载入历史" @click="loadHistory"><History class="w-4 h-4" /></button>
      <button class="icon-btn" title="清空历史" @click="clearHistory"><Trash2 class="w-4 h-4" /></button>
    </div>
    <p v-if="!store.config.apiKey" class="alert-warning">尚未配置 AI API Key，请先前往设置。</p>
    <div ref="boxEl" class="card flex-1 min-h-[320px] overflow-auto p-4 space-y-3">
      <div v-if="!messages.length" class="empty-state border-0"><Bot class="w-8 h-8" /><span>选择容器进行诊断，或直接询问 Docker Compose 问题</span></div>
      <div v-for="message in messages" :key="message.id" class="flex" :class="message.role === 'user' ? 'justify-end' : 'justify-start'">
        <div class="message" :class="message.role === 'user' ? 'message-user' : 'message-assistant'">{{ message.content }}</div>
      </div>
      <div v-if="streaming" class="flex justify-start"><div class="message message-assistant">{{ buffer }}<span class="animate-pulse">|</span></div></div>
    </div>
    <div class="flex gap-2">
      <textarea v-model="input" class="input flex-1 resize-none" rows="2" placeholder="输入问题，Enter 发送，Shift+Enter 换行" @keydown.enter.exact.prevent="send"></textarea>
      <button v-if="!streaming" class="btn-primary self-end" :disabled="!input.trim()" @click="send"><Send class="w-4 h-4" />发送</button>
      <button v-else class="btn-danger self-end" @click="stop"><Square class="w-4 h-4" />停止</button>
    </div>
  </div>
</template>
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { Bot, History, Send, Square, Stethoscope, Trash2 } from 'lucide-vue-next';
import { useAiStore } from '../stores/ai.js'; import { api, streamSse } from '../api/client.js';
const route = useRoute(); const store = useAiStore(); const projects = ref([]); const projectId = ref(route.query.projectId || ''); const containerId = ref(route.query.containerId || ''); const messages = ref([]); const input = ref(''); const streaming = ref(false); const buffer = ref(''); const boxEl = ref(null); let controller; let nextId = 0;
const containers = computed(() => projects.value.find((p) => p.id === projectId.value)?.containers || []);
onMounted(async () => { await Promise.all([store.loadConfig(), loadHistory(), api.getProjects().then((r) => projects.value = r.projects.filter((project) => project.managed))]); if (route.query.diagnose === '1' && containerId.value && projects.value.some((project) => project.id === projectId.value)) diagnose(); });
async function loadHistory() { await store.loadHistory(); messages.value = store.history.map((m) => ({ id: m.id || ++nextId, role: m.role, content: m.content })); scroll(); }
async function clearHistory() { if (!confirm('确认清空 AI 对话历史？')) return; await store.clearHistory(); messages.value = []; }
async function send() { const text = input.value.trim(); if (!text || streaming.value) return; input.value = ''; messages.value.push({ id: ++nextId, role: 'user', content: text }); await chat('/ai/chat', { message: text }); }
async function diagnose() { const name = containers.value.find((c) => c.id === containerId.value)?.name || containerId.value; messages.value.push({ id: ++nextId, role: 'user', content: `诊断容器 ${name}` }); await chat('/ai/diagnose', { projectId: projectId.value, containerId: containerId.value }); }
async function chat(path, body) {
  streaming.value = true; buffer.value = ''; controller = new AbortController(); scroll();
  try { await streamSse(path, body, (frame) => { if (frame.type === 'token') buffer.value += frame.data; if (frame.type === 'done') { messages.value.push({ id: ++nextId, role: 'assistant', content: frame.data || buffer.value }); buffer.value = ''; } if (frame.type === 'error') { messages.value.push({ id: ++nextId, role: 'assistant', content: `请求失败：${frame.data}` }); buffer.value = ''; } scroll(); }, controller.signal); }
  catch (e) { if (e.name !== 'AbortError') messages.value.push({ id: ++nextId, role: 'assistant', content: `请求失败：${e.message}` }); }
  finally { streaming.value = false; controller = null; }
}
function stop() { controller?.abort(); }
function scroll() { nextTick(() => { if (boxEl.value) boxEl.value.scrollTop = boxEl.value.scrollHeight; }); }
onBeforeUnmount(stop);
</script>
