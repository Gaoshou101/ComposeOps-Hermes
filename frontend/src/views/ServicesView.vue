<template>
  <div class="space-y-4">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div><h1 class="page-title">服务总览</h1><p class="page-subtitle">自动发现 {{ store.projects.length }} 个项目 · 已纳管 {{ managedCount }} 个 · {{ containerCount }} 个容器</p></div>
      <div class="flex items-center gap-2">
        <label class="toggle-label"><input v-model="autoRefresh" type="checkbox" />自动刷新</label>
        <button class="btn-secondary" :disabled="store.loading" @click="refresh"><RefreshCw class="w-4 h-4" :class="{ 'animate-spin': store.loading }" />刷新</button>
      </div>
    </div>

    <p v-if="store.error" class="alert-error">{{ store.error }}</p>
    <div v-if="!store.projects.length && !store.loading" class="empty-state"><Boxes class="w-8 h-8" /><span>暂未发现 Compose 项目</span></div>

    <div class="space-y-2">
      <article v-for="project in store.projects" :key="project.id" class="card overflow-hidden">
        <header class="min-h-14 flex items-center gap-1 px-2 md:px-3">
          <button class="icon-btn" :title="project.favorite ? '取消收藏' : '收藏项目'" @click="toggleFavorite(project)">
            <Star class="w-4 h-4" :class="project.favorite ? 'fill-amber-400 text-amber-400' : ''" />
          </button>
          <button class="min-w-0 flex-1 self-stretch flex items-center gap-3 text-left px-1" :aria-expanded="isExpanded(project.id)" @click="toggleExpanded(project.id)">
            <div class="min-w-0 flex-1 sm:flex-none sm:w-48 md:w-60">
              <div class="font-mono text-sm font-medium truncate">{{ project.projectName }}</div>
            </div>
            <span class="status-dot sm:hidden" :class="project.status === 'running' ? 'bg-green-400' : project.status === 'partial' ? 'bg-amber-400' : 'bg-red-400'"></span>
            <div class="hidden sm:block"><StatusBadge :status="project.status" /></div>
            <span class="count-badge shrink-0" :class="project.managed ? 'text-green-300' : ''">{{ project.managed ? '已纳管' : '未纳管' }}</span>
            <span class="hidden sm:inline text-xs text-surface-500 shrink-0">{{ project.containers.length }} 个容器</span>
            <span class="hidden lg:inline text-xs text-surface-500 shrink-0">{{ project.owner }}</span>
            <span class="hidden md:block text-xs text-surface-500 font-mono truncate flex-1" :title="project.workingDir">{{ project.workingDir }}</span>
            <ChevronDown class="w-4 h-4 text-surface-500 shrink-0 transition-transform" :class="{ 'rotate-180': isExpanded(project.id) }" />
          </button>
          <button class="icon-btn" title="编辑备注" @click="editNote(project)"><Pencil class="w-4 h-4" /></button>
        </header>

        <div v-if="isExpanded(project.id)" class="border-t border-surface-800 p-3 md:p-4 space-y-3">
          <div class="flex flex-col lg:flex-row lg:items-center gap-2">
            <div class="min-w-0 flex-1">
              <p class="text-xs text-surface-500 font-mono break-all">{{ project.workingDir || 'Docker 标签未提供工作目录' }}</p>
              <p v-if="project.note" class="text-sm text-surface-300 border-l-2 border-surface-700 pl-2 mt-2">{{ project.note }}</p>
            </div>
            <span v-if="project.managed" class="count-badge self-start lg:self-auto">{{ project.mounted ? 'Compose 模式' : '现有容器模式' }}</span>
          </div>

          <div class="flex flex-wrap gap-1.5">
            <button class="btn-primary" :disabled="!project.managed || busy" :title="project.mounted ? '通过 Docker Compose 启动' : '启动项目中已有的容器'" @click="run(project, 'up')"><Play class="w-4 h-4" />启动</button>
            <button class="btn-secondary" :disabled="!project.managed || busy" @click="run(project, 'restart')"><RotateCw class="w-4 h-4" />重启</button>
            <button class="btn-danger" :disabled="!project.managed || busy" @click="confirmStop(project)"><Square class="w-4 h-4" />停止</button>
            <button class="btn-ghost" :disabled="!project.managed || busy" @click="run(project, 'ps')"><ListTree class="w-4 h-4" />状态</button>
            <button class="btn-secondary" :disabled="!project.editable || busy" title="拉取镜像需要 Compose 目录" @click="run(project, 'pull')"><Download class="w-4 h-4" />拉取</button>
            <router-link class="btn-ghost" :class="{ 'pointer-events-none opacity-40': !project.editable }" :to="`/compose?projectId=${project.id}`"><FileCode2 class="w-4 h-4" />配置</router-link>
          </div>

          <div v-if="!project.managed" class="alert-warning flex flex-col sm:flex-row sm:items-center gap-2">
            <span class="flex-1">项目尚未纳管，所有控制与容器入口均已禁用。</span>
            <router-link class="btn-ghost shrink-0" :to="`/settings?tab=mounts&projectId=${project.id}`"><FolderCog class="w-4 h-4" />项目纳管</router-link>
          </div>
          <div v-else-if="!project.mounted" class="alert-warning flex flex-col sm:flex-row sm:items-center gap-2">
            <span class="flex-1">当前可启动、重启、停止和查看已有容器；拉取、创建缺失服务及编辑配置需要挂载 Compose 目录。</span>
            <router-link class="btn-ghost shrink-0" :to="`/settings?tab=mounts&projectId=${project.id}`"><FolderCog class="w-4 h-4" />配置挂载</router-link>
          </div>

          <div class="divide-y divide-surface-800 border-t border-surface-800">
            <div v-for="container in project.containers" :key="container.id" class="min-h-12 py-2 flex items-center gap-2">
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
        </div>
      </article>
    </div>

    <div v-if="output.open" class="drawer">
      <div class="modal-header"><span>{{ actionLabel(output.action) }} · {{ output.name }}</span><button class="icon-btn" @click="output.open = false"><X class="w-4 h-4" /></button></div>
      <pre class="terminal-output flex-1">{{ output.text }}</pre>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { Bot, Boxes, ChevronDown, Download, FileCode2, FolderCog, ListTree, Pencil, Play, RefreshCw, RotateCw, ScrollText, Square, Star, TerminalSquare, X } from 'lucide-vue-next';
import { useServicesStore } from '../stores/services.js';
import { api, streamComposeControl } from '../api/client.js';
import StatusBadge from '../components/StatusBadge.vue';

const store = useServicesStore();
const autoRefresh = ref(true); const busy = ref(false); const expandedIds = ref(new Set());
const output = reactive({ open: false, text: '', action: '', name: '' });
const containerCount = computed(() => store.projects.reduce((count, project) => count + project.containers.length, 0));
const managedCount = computed(() => store.projects.filter((project) => project.managed).length);

function refresh() { return store.refresh(); }
function isExpanded(projectId) { return expandedIds.value.has(projectId); }
function toggleExpanded(projectId) { const next = new Set(expandedIds.value); if (next.has(projectId)) next.delete(projectId); else next.add(projectId); expandedIds.value = next; }
function portText(container) { return container.ports.map((port) => `${port.public}:${port.private}`).join(', '); }
function actionLabel(action) { return ({ up: '启动', restart: '重启', stop: '停止', pull: '拉取', ps: '状态' })[action] || action; }
async function toggleFavorite(project) { project.favorite = !project.favorite; await api.saveProjectPreference(project.id, { favorite: project.favorite }); await refresh(); }
async function editNote(project) {
  const note = window.prompt('项目备注（最多 500 字）', project.note || '');
  if (note === null) return;
  project.note = note.slice(0, 500); await api.saveProjectPreference(project.id, { note: project.note });
}
function confirmStop(project) { if (window.confirm(`确认停止 ${project.projectName} 中现有的容器？不会删除容器和网络。`)) run(project, 'stop'); }
async function run(project, action) {
  busy.value = true; output.open = true; output.text = ''; output.action = action; output.name = project.projectName;
  try {
    await streamComposeControl(project.id, action, (frame) => {
      if (frame.type === 'stdout' || frame.type === 'stderr') output.text += frame.data;
      if (frame.type === 'error') output.text += `\n[错误] ${frame.data}`;
      if (frame.type === 'exit') output.text += `\n[退出码 ${frame.data.code}]`;
    });
    await refresh();
  } catch (error) { output.text += `\n[请求失败] ${error.message}`; }
  finally { busy.value = false; }
}
watch(autoRefresh, async (value) => { if (!value) return store.stopAutoRefresh(); const preferences = await api.getPreferences(); store.startAutoRefresh(preferences.refreshInterval * 1000); });
onMounted(async () => { const preferences = await api.getPreferences(); store.startAutoRefresh(preferences.refreshInterval * 1000); });
onUnmounted(store.stopAutoRefresh);
</script>
