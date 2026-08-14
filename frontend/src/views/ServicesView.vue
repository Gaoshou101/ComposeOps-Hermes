<template>
  <div class="space-y-5">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div><h1 class="page-title">服务总览</h1><p class="page-subtitle">自动发现 {{ store.projects.length }} 个项目 · 已纳管 {{ managedCount }} 个 · {{ containerCount }} 个容器</p></div>
      <div class="flex items-center gap-2">
        <label class="toggle-label"><input type="checkbox" v-model="autoRefresh" />自动刷新</label>
        <button class="btn-secondary" @click="refresh" :disabled="store.loading"><RefreshCw class="w-4 h-4" :class="{ 'animate-spin': store.loading }" />刷新</button>
      </div>
    </div>
    <p v-if="store.error" class="alert-error">{{ store.error }}</p>
    <div v-if="!store.projects.length && !store.loading" class="empty-state"><Boxes class="w-8 h-8" /><span>暂未发现 Compose 项目</span></div>

    <section v-for="group in groups" :key="group.owner" class="space-y-2">
      <div class="flex items-center gap-2"><h2 class="section-title">{{ group.owner }}</h2><span class="count-badge">{{ group.projects.length }}</span></div>
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <article v-for="project in group.projects" :key="project.id" class="card p-4 space-y-3">
          <header class="flex items-start gap-3">
            <button class="icon-btn mt-0.5" :title="project.favorite ? '取消收藏' : '收藏项目'" @click="toggleFavorite(project)">
              <Star class="w-4 h-4" :class="project.favorite ? 'fill-amber-400 text-amber-400' : ''" />
            </button>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 min-w-0"><h3 class="font-mono font-medium truncate flex-1">{{ project.projectName }}</h3><StatusBadge :status="project.status" /><span class="count-badge shrink-0">{{ project.managed ? '已纳管' : '未纳管' }}</span></div>
              <p class="text-xs text-surface-500 truncate mt-1" :title="project.workingDir">{{ project.workingDir }}</p>
            </div>
            <button class="icon-btn" title="编辑备注" @click="editNote(project)"><Pencil class="w-4 h-4" /></button>
          </header>
          <p v-if="project.note" class="text-sm text-surface-300 border-l-2 border-surface-700 pl-2">{{ project.note }}</p>

          <div class="flex flex-wrap gap-1.5">
            <button class="btn-primary" :disabled="!project.editable || busy" @click="run(project, 'up')"><Play class="w-4 h-4" />启动</button>
            <button class="btn-secondary" :disabled="!project.editable || busy" @click="run(project, 'restart')"><RotateCw class="w-4 h-4" />重启</button>
            <button class="btn-secondary" :disabled="!project.editable || busy" @click="run(project, 'pull')"><Download class="w-4 h-4" />拉取</button>
            <button class="btn-ghost" :disabled="!project.editable || busy" @click="run(project, 'ps')"><ListTree class="w-4 h-4" />状态</button>
            <button class="btn-danger" :disabled="!project.editable || busy" @click="confirmDown(project)"><Square class="w-4 h-4" />停止</button>
            <router-link class="btn-ghost" :class="{ 'pointer-events-none opacity-40': !project.editable }" :to="`/compose?projectId=${project.id}`"><FileCode2 class="w-4 h-4" />配置</router-link>
          </div>
          <div v-if="!project.editable" class="alert-warning flex flex-col sm:flex-row sm:items-center gap-2">
            <span class="flex-1">{{ readonlyMessage(project) }}</span>
            <router-link class="btn-ghost shrink-0" :to="`/settings?tab=mounts&projectId=${project.id}`"><FolderCog class="w-4 h-4" />{{ project.managed ? '配置挂载' : '项目纳管' }}</router-link>
          </div>

          <div class="divide-y divide-surface-800 border-t border-surface-800">
            <div v-for="container in project.containers" :key="container.id" class="py-2 flex items-center gap-2">
              <span class="status-dot" :class="container.state === 'running' ? 'bg-green-400' : 'bg-red-400'"></span>
              <div class="min-w-0 flex-1">
                <div class="text-sm font-mono truncate">{{ container.name }}</div>
                <div class="text-xs text-surface-500 truncate">{{ container.image }}<span v-if="container.ports.length"> · {{ portText(container) }}</span><span v-if="container.health"> · {{ container.health }}</span></div>
              </div>
              <router-link class="icon-btn" :class="{ 'pointer-events-none opacity-40': !project.managed }" title="实时日志" :to="`/logs?projectId=${project.id}&containerId=${container.id}`"><ScrollText class="w-4 h-4" /></router-link>
              <router-link class="icon-btn" :class="{ 'pointer-events-none opacity-40': !project.managed }" title="容器终端" :to="`/shell?projectId=${project.id}&containerId=${container.id}`"><TerminalSquare class="w-4 h-4" /></router-link>
              <router-link class="icon-btn" :class="{ 'pointer-events-none opacity-40': !project.managed }" title="AI 诊断" :to="`/ai?projectId=${project.id}&containerId=${container.id}&diagnose=1`"><Bot class="w-4 h-4" /></router-link>
            </div>
          </div>
        </article>
      </div>
    </section>

    <div v-if="output.open" class="drawer">
      <div class="modal-header"><span>compose {{ output.action }} · {{ output.name }}</span><button class="icon-btn" @click="output.open = false"><X class="w-4 h-4" /></button></div>
      <pre class="terminal-output flex-1">{{ output.text }}</pre>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { Bot, Boxes, Download, FileCode2, FolderCog, ListTree, Pencil, Play, RefreshCw, RotateCw, ScrollText, Square, Star, TerminalSquare, X } from 'lucide-vue-next';
import { useServicesStore } from '../stores/services.js';
import { api, streamComposeControl } from '../api/client.js';
import StatusBadge from '../components/StatusBadge.vue';

const store = useServicesStore();
const autoRefresh = ref(true); const busy = ref(false);
const output = reactive({ open: false, text: '', action: '', name: '' });
const containerCount = computed(() => store.projects.reduce((n, p) => n + p.containers.length, 0));
const managedCount = computed(() => store.projects.filter((project) => project.managed).length);
const groups = computed(() => {
  const map = new Map();
  for (const p of store.projects) { if (!map.has(p.owner)) map.set(p.owner, []); map.get(p.owner).push(p); }
  return [...map].map(([owner, projects]) => ({ owner, projects }));
});

function refresh() { return store.refresh(); }
function portText(c) { return c.ports.map((p) => `${p.public}:${p.private}`).join(', '); }
function readonlyMessage(project) {
  if (!project.managed) return '已自动发现，但尚未加入管理；当前禁止控制、配置、日志、终端和 AI 诊断。';
  if (project.mountState === 'metadata_missing') return 'Docker 标签没有提供工作目录，无法生成自动挂载建议。';
  if (project.mountState === 'compose_files_unreachable' && project.workingDirReachable) return '工作目录可达，但标签中的 Compose 文件不存在或不可读。';
  return '项目已纳管；日志、终端和 AI 诊断可用，Compose 控制与配置需先完成同路径挂载。';
}
async function toggleFavorite(project) { project.favorite = !project.favorite; await api.saveProjectPreference(project.id, { favorite: project.favorite }); }
async function editNote(project) {
  const note = window.prompt('项目备注（最多 500 字）', project.note || '');
  if (note === null) return;
  project.note = note.slice(0, 500); await api.saveProjectPreference(project.id, { note: project.note });
}
function confirmDown(project) { if (window.confirm(`确认停止 ${project.projectName}？`)) run(project, 'down'); }
async function run(project, action) {
  busy.value = true; output.open = true; output.text = ''; output.action = action; output.name = project.projectName;
  try {
    await streamComposeControl(project.id, action, (frame) => {
      if (frame.type === 'stdout' || frame.type === 'stderr') output.text += frame.data;
      if (frame.type === 'error') output.text += `\n[错误] ${frame.data}`;
      if (frame.type === 'exit') output.text += `\n[退出码 ${frame.data.code}]`;
    });
    await refresh();
  } catch (e) { output.text += `\n[请求失败] ${e.message}`; }
  finally { busy.value = false; }
}
watch(autoRefresh, async (value) => { if (!value) return store.stopAutoRefresh(); const prefs = await api.getPreferences(); store.startAutoRefresh(prefs.refreshInterval * 1000); });
onMounted(async () => { const prefs = await api.getPreferences(); store.startAutoRefresh(prefs.refreshInterval * 1000); }); onUnmounted(store.stopAutoRefresh);
</script>
