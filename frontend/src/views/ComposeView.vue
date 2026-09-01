<template>
  <div class="page-shell page-shell-workspace">
    <div class="page-header">
      <div><h1 class="page-title">Compose 配置</h1><p class="page-subtitle">保存前执行 YAML 与 docker compose config 校验</p></div>
      <div class="page-actions">
        <select v-model="projectId" class="input min-w-52" @change="selectProject"><option value="">选择项目</option><option v-for="p in projects" :key="p.id" :value="p.id">{{ p.projectName }}</option></select>
        <select v-if="project?.composeFiles.length > 1" v-model.number="fileIndex" class="input" @change="load"><option v-for="(file, i) in project.composeFiles" :key="file" :value="i">{{ shortName(file) }}</option></select>
        <button class="btn-secondary" :disabled="!content" @click="validateSemantics"><ShieldCheck class="w-4 h-4" />语义校验</button>
        <select v-model="templateId" class="input w-40" title="常用服务模板" @change="insertTemplate">
          <option value="">插入模板...</option>
          <option v-for="template in templates" :key="template.id" :value="template.id">{{ template.label }} · {{ template.description }}</option>
        </select>
        <button class="btn-secondary" :disabled="!content" @click="formatYaml"><AlignLeft class="w-4 h-4" />格式化</button>
        <button class="btn-secondary" :disabled="!projectId" @click="loadBackups"><History class="w-4 h-4" />备份</button>
        <button class="btn-primary" :disabled="saving || !dirty" @click="save"><Save class="w-4 h-4" />{{ saving ? '校验中...' : '保存' }}</button>
      </div>
    </div>
    <div v-if="filePath" class="text-muted font-mono truncate">{{ filePath }}<span v-if="dirty" class="text-amber-400 ml-2">● 未保存</span></div>
    <p v-if="error" class="alert-error">{{ error }}</p><p v-if="message" class="alert-success">{{ message }}</p>
    <div v-if="semanticIssues.length" class="card p-3 space-y-1.5 border border-amber-900/40">
      <div class="flex items-center gap-2 text-xs font-semibold text-amber-300"><ShieldAlert class="w-4 h-4" />语义校验 {{ semanticIssues.filter((i) => i.level === 'error').length }} 个错误 · {{ semanticIssues.filter((i) => i.level === 'warn').length }} 个警告</div>
      <p v-for="(issue, index) in semanticIssues" :key="index" class="flex items-start gap-2 text-xs" :class="issue.level === 'error' ? 'text-rose-300' : issue.level === 'warn' ? 'text-amber-200' : 'text-surface-400'">
        <span class="shrink-0 font-semibold">{{ issue.level === 'error' ? '✕' : issue.level === 'warn' ? '!' : 'i' }}</span>
        <span>{{ issue.message }}<template v-if="issue.service"> · {{ issue.service }}</template></span>
      </p>
    </div>
    <EmptyState v-if="!projectId" icon="FileCode2" title="请先选择一个已挂载的项目" description="选择项目后即可查看与编辑 Compose 配置" class="flex-1" />
    <div v-else class="card relative flex-1 min-h-[420px] overflow-hidden ring-1 ring-black/10">
      <Skeleton v-if="!editorReady" class="skeleton-workspace" rows="10" label="编辑器加载中" />
      <div ref="editorEl" class="absolute inset-0" :class="{ invisible: !editorReady }"></div>
    </div>

    <div v-if="showBackups" class="modal-backdrop z-[55]" @click.self="showBackups = false">
      <div class="modal max-w-[calc(100vw-2rem)] sm:max-w-3xl">
        <div class="modal-header"><span>配置备份（最近 20 份）</span><button class="icon-btn" @click="showBackups = false"><X class="w-4 h-4" /></button></div>
        <div class="p-3 space-y-2 overflow-auto max-h-[60vh]">
          <EmptyState icon="History" compact title="暂无配置备份" description="保存一次配置后会自动产生备份" />
          <div v-for="backup in backups" :key="backup.id" class="card p-3 flex items-center gap-3">
            <div class="flex-1"><div class="text-sm">{{ formatTime(backup.createdAt) }}</div><div class="text-muted">{{ backup.reason }} · {{ backup.size }} 字符</div></div>
            <button class="btn-ghost" @click="previewBackup(backup)"><Eye class="w-4 h-4" />比较</button>
            <button class="btn-secondary" @click="restore(backup)"><Undo2 class="w-4 h-4" />恢复</button>
          </div>
        </div>
      </div>
    </div>
    <div v-if="showPreview && changePreview" class="modal-backdrop z-[55]" @click.self="closePreview">
      <div class="modal max-w-[calc(100vw-2rem)] sm:max-w-2xl">
        <div class="modal-header"><span>保存前变更预览</span><button class="icon-btn" @click="closePreview"><X class="w-4 h-4" /></button></div>
        <div class="p-3 space-y-3 max-h-[70vh] overflow-auto">
          <div v-if="changePreview.added.length" class="rounded-lg border border-emerald-900/40 bg-emerald-950/20 p-2.5">
            <div class="text-xs font-semibold text-emerald-300">新增服务 {{ changePreview.added.length }}</div>
            <div class="mt-1 flex flex-wrap gap-1.5"><span v-for="item in changePreview.added" :key="item.service" class="count-badge text-emerald-300">{{ item.service }}</span></div>
          </div>
          <div v-if="changePreview.changed.length" class="rounded-lg border border-amber-900/40 bg-amber-950/20 p-2.5">
            <div class="text-xs font-semibold text-amber-300">配置变更,容器将被重建 {{ changePreview.changed.length }}</div>
            <div class="mt-1 space-y-1">
              <p v-for="item in changePreview.changed" :key="item.service" class="text-xs text-surface-300">{{ item.service }} <span class="text-surface-500">· {{ item.reasons.join(', ') }} · {{ item.container }}</span></p>
            </div>
          </div>
          <div v-if="changePreview.restarted.length" class="rounded-lg border border-sky-900/40 bg-sky-950/20 p-2.5">
            <div class="text-xs font-semibold text-sky-300">运行中容器将重启 {{ changePreview.restarted.length }}</div>
            <div class="mt-1 flex flex-wrap gap-1.5"><span v-for="item in changePreview.restarted" :key="item.service" class="count-badge text-sky-300">{{ item.service }}</span></div>
          </div>
          <div v-if="changePreview.removed.length" class="rounded-lg border border-rose-900/40 bg-rose-950/20 p-2.5">
            <div class="text-xs font-semibold text-rose-300">将被移除的服务 {{ changePreview.removed.length }}</div>
            <div class="mt-1 space-y-1"><p v-for="item in changePreview.removed" :key="item.service" class="text-xs text-surface-300">{{ item.service }} <span class="text-surface-500">· {{ item.container }} ({{ item.state }})</span></p></div>
          </div>
          <p v-if="!changePreview.added.length && !changePreview.changed.length && !changePreview.restarted.length && !changePreview.removed.length" class="text-xs text-surface-400">未检测到会影响现有容器的变更,可直接保存。</p>
        </div>
        <footer class="flex items-center justify-end gap-2 border-t border-surface-800 px-4 py-2.5">
          <button class="btn-ghost" @click="closePreview">取消</button>
          <button class="btn-primary" @click="confirmSave"><Save class="w-4 h-4" />确认保存</button>
        </footer>
      </div>
    </div>
    <div v-if="comparison" class="modal-backdrop z-[55]" @click.self="comparison = null">
      <div class="modal max-w-[calc(100vw-2rem)] sm:max-w-6xl"><div class="modal-header"><span>当前配置与备份比较</span><button class="icon-btn" @click="comparison = null"><X class="w-4 h-4" /></button></div><div class="grid md:grid-cols-2 gap-px bg-surface-800 max-h-[70vh] overflow-auto">
          <pre class="diff-pane"><template v-for="(row, index) in diffOld" :key="'o' + index"><span class="diff-line" :class="row.type === 'remove' ? 'diff-remove' : 'diff-same'">{{ row.text }}</span>
</template></pre>
          <pre class="diff-pane"><template v-for="(row, index) in diffNew" :key="'n' + index"><span class="diff-line" :class="row.type === 'add' ? 'diff-add' : 'diff-same'">{{ row.text }}</span>
</template></pre>
        </div></div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useEscapeKey } from '../composables/useEscapeKey.js';
import { useToastStore } from '../stores/toast.js';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { AlignLeft, Eye, FileCode2, History, Save, ShieldAlert, ShieldCheck, Undo2, X } from 'lucide-vue-next';
import Skeleton from '../components/common/Skeleton.vue';
import { diffLines } from '../lib/diff.js';
import { composeTemplates } from '../lib/composeTemplates.js';
import EmptyState from '../components/common/EmptyState.vue';
import * as YAML from 'yaml';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { api } from '../api/client.js';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
const route = useRoute(); const router = useRouter();
const editorEl = ref(null); const editorReady = ref(false); const projects = ref([]); const projectId = ref(route.query.projectId || '');
const fileIndex = ref(0); const filePath = ref(''); const content = ref(''); const original = ref('');
const saving = ref(false); const error = ref(''); const message = ref(''); const backups = ref([]);
const showBackups = ref(false); const comparison = ref(null);
const diffOld = computed(() => comparison.value ? diffLines(comparison.value.content, content.value).filter((row) => row.type !== 'add') : []);
const diffNew = computed(() => comparison.value ? diffLines(comparison.value.content, content.value).filter((row) => row.type !== 'remove') : []);
const semanticIssues = ref([]);
const changePreview = ref(null);
const showPreview = ref(false);
const previewLoading = ref(false);
const templateId = ref('');
const templates = composeTemplates;
let editor;
const project = computed(() => projects.value.find((p) => p.id === projectId.value));
const dirty = computed(() => content.value !== original.value);
const toast = useToastStore();
useEscapeKey({ active: showBackups, onClose: () => { showBackups.value = false; }, layer: 'modal', lockBody: true });
useEscapeKey({ active: computed(() => !!comparison.value), onClose: () => { comparison.value = null; }, layer: 'modal', lockBody: true });
useEscapeKey({ active: computed(() => showPreview.value), onClose: closePreview, layer: 'modal', lockBody: true });

onMounted(async () => {
  await reloadProjects();
  await nextTick(); createEditor(); if (projectId.value) await load();
  window.addEventListener('beforeunload', beforeUnload);
  window.addEventListener('composeops:host-changed', onHostChanged);
});
async function reloadProjects() { projects.value = (await api.getProjects()).projects.filter((p) => p.editable); }
function onHostChanged() {
  if (dirty.value && !window.confirm('节点已切换,当前未保存的修改将丢失,确认继续?')) return;
  void reloadProjects().then(() => { if (projectId.value && !projects.value.some((p) => p.id === projectId.value)) { projectId.value = ''; selectProject(); } });
}
onBeforeUnmount(() => { editor?.dispose(); window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('composeops:host-changed', onHostChanged); });
onBeforeRouteLeave(() => !dirty.value || window.confirm('配置尚未保存，确认离开？'));
function beforeUnload(event) { if (dirty.value) { event.preventDefault(); event.returnValue = ''; } }
function createEditor() {
  if (!editorEl.value || editor) return;
  editor = monaco.editor.create(editorEl.value, { value: '', language: 'yaml', theme: 'vs-dark', automaticLayout: true, fontSize: 13, minimap: { enabled: false }, tabSize: 2, scrollBeyondLastLine: false });
  editor.onDidChangeModelContent(() => { content.value = editor.getValue(); message.value = ''; });
  editorReady.value = true;
}
async function selectProject() { fileIndex.value = 0; await router.replace({ query: projectId.value ? { projectId: projectId.value } : {} }); await nextTick(); createEditor(); if (projectId.value) load(); }
async function load() {
  error.value = ''; message.value = ''; semanticIssues.value = []; showPreview.value = false; changePreview.value = null;
  try { const data = await api.getComposeFile(projectId.value, fileIndex.value); filePath.value = data.path; original.value = content.value = data.content; editor?.setValue(data.content); }
  catch (e) { error.value = e.message; }
}
async function validateSemantics() {
  error.value = '';
  if (!content.value.trim()) { semanticIssues.value = []; return; }
  try {
    const result = await api.validateCompose(projectId.value, fileIndex.value, content.value);
    semanticIssues.value = result.issues || [];
  } catch (e) { error.value = e.message; }
}
async function save() {
  error.value = '';
  await validateSemantics();
  const hasError = semanticIssues.value.some((issue) => issue.level === 'error');
  if (hasError && !window.confirm(`语义校验发现 ${semanticIssues.value.filter((i) => i.level === 'error').length} 个错误,仍要保存?`)) return;
  // 保存前展示变更预览(影响哪些容器会被重建/重启)
  previewLoading.value = true;
  try {
    changePreview.value = await api.previewCompose(projectId.value, content.value);
    const preview = changePreview.value || {};
    const impactful = (preview.added || []).length + (preview.changed || []).length + (preview.restarted || []).length + (preview.removed || []).length;
    if (impactful) { showPreview.value = true; return; } // 有影响,等用户确认
  } catch { changePreview.value = null; }
  previewLoading.value = false;
  await confirmSave(); // 无影响或预览失败时直接保存
}
async function confirmSave() {
  saving.value = true; error.value = '';
  try {
    await api.saveComposeFile(projectId.value, fileIndex.value, content.value);
    original.value = content.value; message.value = `已校验并保存 · ${new Date().toLocaleTimeString()}`;
    showPreview.value = false; changePreview.value = null; semanticIssues.value = [];
  }
  catch (e) { error.value = e.message; }
  finally { saving.value = false; }
}
function closePreview() { showPreview.value = false; changePreview.value = null; }
function insertTemplate() {
  const template = templates.find((item) => item.id === templateId.value);
  templateId.value = '';
  if (!template || !editor) return;
  const current = editor.getValue();
  const snippet = `\n${template.insert}\n`;
  // 定位到 services 段末(在第一个顶层 key 之前插入服务);简单策略:追加到文件末尾
  const hasServices = /^services:/m.test(current);
  const insertAt = hasServices ? current.length : current.length;
  const next = hasServices
    ? current.replace(/(^services:\n)/, `$1${snippet}`)
    : `${current}${current ? '\n' : ''}services:\n${template.insert}\n`;
  editor.setValue(next);
  editor.trigger('keyboard', 'editor.action.formatDocument', {});
  message.value = `已插入模板「${template.label}」,请按需修改`;
}
function formatYaml() { try { const next = YAML.stringify(YAML.parse(content.value), { indent: 2, lineWidth: 0 }); editor.setValue(next); } catch (e) { error.value = e.message; } }
async function loadBackups() { backups.value = (await api.getBackups(projectId.value)).backups || []; showBackups.value = true; }
async function previewBackup(backup) { comparison.value = await api.getBackup(projectId.value, backup.id); }
async function restore(backup) { if (!confirm('恢复该备份?当前配置也会先自动备份。')) return; try { await api.restoreBackup(projectId.value, backup.id); showBackups.value = false; await load(); toast.success('配置版本已成功回滚并生效'); message.value = '备份已恢复'; } catch (e) { error.value = e.message; } }
function shortName(file) { return file.split('/').pop(); }
function formatTime(value) { return new Date(`${value}Z`).toLocaleString(); }
</script>
