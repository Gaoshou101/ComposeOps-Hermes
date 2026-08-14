<template>
  <div class="h-full flex flex-col gap-3">
    <div class="flex flex-col lg:flex-row lg:items-center gap-2">
      <div class="mr-auto"><h1 class="page-title">Compose 配置</h1><p class="page-subtitle">保存前执行 YAML 与 docker compose config 校验</p></div>
      <select v-model="projectId" class="input min-w-52" @change="selectProject"><option value="">选择项目</option><option v-for="p in projects" :key="p.id" :value="p.id">{{ p.projectName }}</option></select>
      <select v-if="project?.composeFiles.length > 1" v-model.number="fileIndex" class="input" @change="load"><option v-for="(file, i) in project.composeFiles" :key="file" :value="i">{{ shortName(file) }}</option></select>
      <button class="btn-secondary" :disabled="!content" @click="formatYaml"><AlignLeft class="w-4 h-4" />格式化</button>
      <button class="btn-secondary" :disabled="!projectId" @click="loadBackups"><History class="w-4 h-4" />备份</button>
      <button class="btn-primary" :disabled="saving || !dirty" @click="save"><Save class="w-4 h-4" />{{ saving ? '校验中...' : '保存' }}</button>
    </div>
    <div v-if="filePath" class="text-xs text-surface-500 font-mono truncate">{{ filePath }}<span v-if="dirty" class="text-amber-400 ml-2">● 未保存</span></div>
    <p v-if="error" class="alert-error">{{ error }}</p><p v-if="message" class="alert-success">{{ message }}</p>
    <div v-if="!projectId" class="empty-state flex-1"><FileCode2 class="w-8 h-8" /><span>请先选择一个已挂载的项目</span></div>
    <div v-else ref="editorEl" class="card flex-1 min-h-[420px] overflow-hidden"></div>

    <div v-if="showBackups" class="modal-backdrop" @click.self="showBackups = false">
      <div class="modal max-w-3xl">
        <div class="modal-header"><span>配置备份（最近 20 份）</span><button class="icon-btn" @click="showBackups = false"><X class="w-4 h-4" /></button></div>
        <div class="p-3 space-y-2 overflow-auto max-h-[60vh]">
          <div v-if="!backups.length" class="empty-state">保存一次配置后会自动产生备份</div>
          <div v-for="backup in backups" :key="backup.id" class="card p-3 flex items-center gap-3">
            <div class="flex-1"><div class="text-sm">{{ formatTime(backup.createdAt) }}</div><div class="text-xs text-surface-500">{{ backup.reason }} · {{ backup.size }} 字符</div></div>
            <button class="btn-ghost" @click="previewBackup(backup)"><Eye class="w-4 h-4" />比较</button>
            <button class="btn-secondary" @click="restore(backup)"><Undo2 class="w-4 h-4" />恢复</button>
          </div>
        </div>
      </div>
    </div>
    <div v-if="comparison" class="modal-backdrop" @click.self="comparison = null">
      <div class="modal max-w-6xl"><div class="modal-header"><span>当前配置与备份比较</span><button class="icon-btn" @click="comparison = null"><X class="w-4 h-4" /></button></div><div class="grid md:grid-cols-2 gap-px bg-surface-800 max-h-[70vh] overflow-auto"><pre class="diff-pane">{{ comparison.content }}</pre><pre class="diff-pane">{{ content }}</pre></div></div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { AlignLeft, Eye, FileCode2, History, Save, Undo2, X } from 'lucide-vue-next';
import * as YAML from 'yaml';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { api } from '../api/client.js';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
const route = useRoute(); const router = useRouter();
const editorEl = ref(null); const projects = ref([]); const projectId = ref(route.query.projectId || '');
const fileIndex = ref(0); const filePath = ref(''); const content = ref(''); const original = ref('');
const saving = ref(false); const error = ref(''); const message = ref(''); const backups = ref([]);
const showBackups = ref(false); const comparison = ref(null); let editor;
const project = computed(() => projects.value.find((p) => p.id === projectId.value));
const dirty = computed(() => content.value !== original.value);

onMounted(async () => {
  projects.value = (await api.getProjects()).projects.filter((p) => p.editable);
  await nextTick(); createEditor(); if (projectId.value) await load();
  window.addEventListener('beforeunload', beforeUnload);
});
onBeforeUnmount(() => { editor?.dispose(); window.removeEventListener('beforeunload', beforeUnload); });
onBeforeRouteLeave(() => !dirty.value || window.confirm('配置尚未保存，确认离开？'));
function beforeUnload(event) { if (dirty.value) { event.preventDefault(); event.returnValue = ''; } }
function createEditor() {
  if (!editorEl.value || editor) return;
  editor = monaco.editor.create(editorEl.value, { value: '', language: 'yaml', theme: 'vs-dark', automaticLayout: true, fontSize: 13, minimap: { enabled: false }, tabSize: 2, scrollBeyondLastLine: false });
  editor.onDidChangeModelContent(() => { content.value = editor.getValue(); message.value = ''; });
}
async function selectProject() { fileIndex.value = 0; await router.replace({ query: projectId.value ? { projectId: projectId.value } : {} }); await nextTick(); createEditor(); if (projectId.value) load(); }
async function load() {
  error.value = ''; message.value = '';
  try { const data = await api.getComposeFile(projectId.value, fileIndex.value); filePath.value = data.path; original.value = content.value = data.content; editor?.setValue(data.content); }
  catch (e) { error.value = e.message; }
}
async function save() {
  saving.value = true; error.value = '';
  try { await api.saveComposeFile(projectId.value, fileIndex.value, content.value); original.value = content.value; message.value = `已校验并保存 · ${new Date().toLocaleTimeString()}`; }
  catch (e) { error.value = e.message; } finally { saving.value = false; }
}
function formatYaml() { try { const next = YAML.stringify(YAML.parse(content.value), { indent: 2, lineWidth: 0 }); editor.setValue(next); } catch (e) { error.value = e.message; } }
async function loadBackups() { backups.value = (await api.getBackups(projectId.value)).backups || []; showBackups.value = true; }
async function previewBackup(backup) { comparison.value = await api.getBackup(projectId.value, backup.id); }
async function restore(backup) { if (!confirm('恢复该备份？当前配置也会先自动备份。')) return; await api.restoreBackup(projectId.value, backup.id); showBackups.value = false; await load(); message.value = '备份已恢复'; }
function shortName(file) { return file.split('/').pop(); }
function formatTime(value) { return new Date(`${value}Z`).toLocaleString(); }
</script>
