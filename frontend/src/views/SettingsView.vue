<template>
  <div class="max-w-2xl space-y-4">
    <div>
      <h1 class="text-xl font-semibold">设置</h1>
      <p class="text-sm text-surface-400">AI 模型与系统配置</p>
    </div>

    <div class="card p-4 space-y-3">
      <h2 class="text-sm font-medium text-surface-300">AI 配置（OpenAI 兼容）</h2>

      <label class="block">
        <span class="text-xs text-surface-400">Base URL</span>
        <input v-model="form.baseUrl" class="input w-full mt-1 font-mono text-xs" placeholder="https://api.openai.com/v1" />
      </label>
      <label class="block">
        <span class="text-xs text-surface-400">API Key</span>
        <input v-model="form.apiKey" class="input w-full mt-1 font-mono text-xs" :placeholder="masked ? '已配置（留空则不变）' : 'sk-...'" type="password" />
      </label>
      <label class="block">
        <span class="text-xs text-surface-400">模型</span>
        <input v-model="form.model" class="input w-full mt-1 font-mono text-xs" placeholder="gpt-4o-mini" />
      </label>
      <label class="block">
        <span class="text-xs text-surface-400">系统 Prompt</span>
        <textarea v-model="form.systemPrompt" rows="4" class="input w-full mt-1 font-mono text-xs"></textarea>
      </label>

      <div class="flex items-center gap-2">
        <button class="btn-primary" @click="save" :disabled="saving">{{ saving ? '保存…' : '保存配置' }}</button>
        <button class="btn-ghost" @click="load">重新加载</button>
        <span v-if="msg" :class="msgCls" class="text-sm">{{ msg }}</span>
      </div>
    </div>

    <div class="card p-4 space-y-2">
      <h2 class="text-sm font-medium text-surface-300">关于</h2>
      <p class="text-sm text-surface-400">OpsDash · ComposeOps —— 轻量级 Docker Compose 运维管理面板。</p>
      <p class="text-xs text-surface-500">后端：Fastify + dockerode + better-sqlite3 · 前端：Vue 3 + Vite + Tailwind</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useAiStore } from '../stores/ai.js';

const store = useAiStore();
const form = ref({ baseUrl: '', apiKey: '', model: '', systemPrompt: '' });
const masked = ref(false);
const saving = ref(false);
const msg = ref('');
const msgCls = ref('');

async function load() {
  await store.loadConfig();
  const c = store.config;
  form.value = { baseUrl: c.baseUrl || '', apiKey: '', model: c.model || '', systemPrompt: c.systemPrompt || '' };
  masked.value = !!c.apiKey;
  msg.value = '';
}
async function save() {
  saving.value = true;
  msg.value = '';
  try {
    const payload = { ...form.value };
    // apiKey 留空则不覆盖
    if (!payload.apiKey) delete payload.apiKey;
    await store.saveConfig(payload);
    msg.value = '已保存';
    msgCls.value = 'text-green-400';
    await load();
  } catch (e) {
    msg.value = e.message;
    msgCls.value = 'text-red-400';
  } finally {
    saving.value = false;
  }
}
onMounted(load);
</script>
