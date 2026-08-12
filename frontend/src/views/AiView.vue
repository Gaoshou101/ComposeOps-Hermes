<template>
  <div class="h-full flex flex-col space-y-3">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold">AI 助手</h1>
      <div class="flex items-center gap-2">
        <button class="btn-ghost" @click="store.loadHistory">载入历史</button>
        <button class="btn-ghost" @click="store.clearHistory">清空历史</button>
      </div>
    </div>

    <p v-if="!store.config.apiKey" class="text-amber-400 text-sm">
      尚未配置 API Key，请前往「设置」页填写。
    </p>

    <div ref="boxEl" class="card flex-1 min-h-0 overflow-auto p-4 space-y-3">
      <div v-if="messages.length === 0" class="text-surface-500 text-sm text-center py-8">
        输入消息或粘贴容器 ID 进行一键日志诊断。
      </div>
      <div
        v-for="(m, i) in messages"
        :key="i"
        class="flex"
        :class="m.role === 'user' ? 'justify-end' : 'justify-start'"
      >
        <div
          class="max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words"
          :class="m.role === 'user'
            ? 'bg-accent text-white'
            : 'bg-surface-800 text-surface-100'"
        >{{ m.content }}</div>
      </div>
      <div v-if="streaming" class="flex justify-start">
        <div class="bg-surface-800 rounded-lg px-3 py-2 text-sm whitespace-pre-wrap">{{ buffer }}<span class="animate-pulse">▌</span></div>
      </div>
    </div>

    <div class="space-y-2">
      <div class="flex gap-2">
        <input
          v-model="containerId"
          class="input flex-1 font-mono text-xs"
          placeholder="（可选）容器 ID 用于一键诊断"
        />
        <button class="btn-secondary" @click="diagnose" :disabled="streaming || !containerId">
          一键诊断
        </button>
      </div>
      <div class="flex gap-2">
        <textarea
          v-model="input"
          class="input flex-1 resize-none"
          rows="2"
          placeholder="向 AI 提问…（Enter 发送，Shift+Enter 换行）"
          @keydown.enter.exact.prevent="send"
        ></textarea>
        <button class="btn-primary self-end" @click="send" :disabled="streaming || !input.trim()">
          发送
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue';
import { useAiStore } from '../stores/ai.js';
import { streamSse } from '../api/client.js';

const store = useAiStore();
const messages = ref([]);
const input = ref('');
const containerId = ref('');
const streaming = ref(false);
const buffer = ref('');
const boxEl = ref(null);

onMounted(async () => {
  await store.loadConfig();
  await store.loadHistory();
  messages.value = store.history.slice(-50).map((m) => ({ role: m.role, content: m.content }));
  scrollBottom();
});

async function send() {
  const text = input.value.trim();
  if (!text || streaming.value) return;
  input.value = '';
  messages.value.push({ role: 'user', content: text });
  await chat('/ai/chat', { message: text });
}

async function diagnose() {
  if (!containerId.value || streaming.value) return;
  messages.value.push({ role: 'user', content: `🔍 诊断容器 ${containerId.value}` });
  await chat('/ai/diagnose', { containerId: containerId.value });
}

async function chat(path, body) {
  streaming.value = true;
  buffer.value = '';
  scrollBottom();
  try {
    await streamSse(path, body, (frame) => {
      if (frame.type === 'token') {
        buffer.value += frame.data;
        scrollBottom();
      } else if (frame.type === 'done') {
        messages.value.push({ role: 'assistant', content: frame.data || buffer.value });
        buffer.value = '';
      } else if (frame.type === 'error') {
        messages.value.push({ role: 'assistant', content: `⚠️ ${frame.data}` });
        buffer.value = '';
      }
    });
  } catch (e) {
    messages.value.push({ role: 'assistant', content: `⚠️ 请求失败: ${e.message}` });
  } finally {
    streaming.value = false;
  }
}

function scrollBottom() {
  nextTick(() => {
    if (boxEl.value) boxEl.value.scrollTop = boxEl.value.scrollHeight;
  });
}
</script>
