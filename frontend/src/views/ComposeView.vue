<template>
  <div class="h-full flex flex-col space-y-3">
    <div class="flex items-center gap-2 flex-wrap">
      <h1 class="text-xl font-semibold">Compose 编辑器</h1>
      <input
        v-model="path"
        class="input flex-1 min-w-[300px] font-mono text-xs"
        placeholder="compose 文件路径或工作目录，例如 /opt/app 或 /opt/app/docker-compose.yml"
      />
      <button class="btn-secondary" @click="load" :disabled="loading">{{ loading ? '加载…' : '加载' }}</button>
      <button class="btn-primary" @click="save" :disabled="saving || !content">
        {{ saving ? '保存…' : '保存' }}
      </button>
      <button class="btn-ghost" @click="formatYaml">格式化</button>
    </div>

    <p v-if="error" class="text-red-400 text-sm font-mono">{{ error }}</p>
    <p v-if="savedAt" class="text-green-400 text-sm">已保存 · {{ savedAt }}</p>

    <div class="card flex-1 min-h-0 overflow-hidden">
      <div ref="editorEl" class="w-full h-full"></div>
    </div>

    <p class="text-xs text-surface-500">
      提示：保存时会自动校验 YAML 语法，非法内容返回 422 且不会落盘。
    </p>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api/client.js';

const route = useRoute();
const editorEl = ref(null);
const path = ref('');
const content = ref('');
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const savedAt = ref('');

let editor;
let monaco;

onMounted(async () => {
  monaco = await import('monaco-editor');
  // 简易 worker 绕过（避免 vite 下 worker 加载问题）
  self.MonacoEnvironment = { getWorker: () => null };
  editor = monaco.editor.create(editorEl.value, {
    value: '',
    language: 'yaml',
    theme: 'vs-dark',
    automaticLayout: true,
    fontSize: 13,
    minimap: { enabled: false },
    tabSize: 2,
    scrollBeyondLastLine: false,
  });
  editor.onDidChangeModelContent(() => {
    content.value = editor.getValue();
  });

  const q = route.query.path;
  if (q) {
    path.value = q;
    load();
  }
});

onBeforeUnmount(() => editor?.dispose());

async function load() {
  if (!path.value) return;
  loading.value = true;
  error.value = '';
  try {
    const data = await api.getComposeFile(path.value);
    content.value = typeof data === 'string' ? data : data.content || '';
    editor.setValue(content.value);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (!path.value || !content.value) return;
  saving.value = true;
  error.value = '';
  try {
    await api.saveComposeFile(path.value, content.value);
    savedAt.value = new Date().toLocaleTimeString();
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}

function formatYaml() {
  editor?.getAction?.('editor.action.formatDocument')?.run();
}
</script>
