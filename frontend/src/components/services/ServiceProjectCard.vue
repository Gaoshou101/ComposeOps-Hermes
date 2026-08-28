<template>
  <article :id="`project-${project.id}`" class="card overflow-hidden" :class="{ 'project-attention': attention, 'ring-1 ring-accent': focused }">
    <header class="min-h-16 flex items-center gap-1 px-2 md:px-4">
      <input type="checkbox" class="ml-2 accent-accent" :checked="selected" :disabled="!project.managed || busy" :aria-label="`选择 ${project.projectName}`" @click.stop @change="$emit('toggle-select')" />
      <button class="icon-btn" :title="project.favorite ? '取消收藏' : '收藏项目'" @click="toggleFavorite(project)">
        <Star class="w-4 h-4" :class="project.favorite ? 'fill-amber-400 text-amber-400' : ''" />
      </button>
      <button class="min-w-0 flex-1 self-stretch flex items-center gap-3 text-left px-1" :aria-expanded="expanded" @click="$emit('toggle-expand')">
        <div class="min-w-0 flex-1 sm:flex-none sm:w-48 md:w-60">
          <div class="font-mono text-sm font-medium truncate">{{ project.projectName }}</div>
        </div>
        <span class="status-dot sm:hidden" :class="statusDotClass"></span>
        <div class="hidden sm:block"><StatusBadge :status="project.status" /></div>
        <span class="count-badge shrink-0" :class="project.managed ? 'text-emerald-300' : ''">{{ project.managed ? '已纳管' : '未纳管' }}</span>
        <span v-if="imageState === 'updated'" class="count-badge shrink-0 bg-amber-950/50 text-amber-300">镜像待应用</span>
        <span v-else-if="imageState === 'failed'" class="count-badge hidden shrink-0 bg-rose-950/50 text-rose-300 lg:inline">镜像检查失败</span>
        <span v-else-if="imageState === 'current'" class="count-badge hidden shrink-0 text-emerald-300 xl:inline">镜像已检查</span>
        <span class="hidden sm:inline text-muted shrink-0">{{ project.containers.length }} 个容器</span>
        <span class="hidden lg:inline text-muted shrink-0">{{ project.owner }}</span>
        <span class="hidden md:block text-muted font-mono truncate flex-1" :title="project.workingDir">{{ project.workingDir }}</span>
        <ChevronDown class="w-4 h-4 text-surface-500 shrink-0 transition-transform" :class="{ 'rotate-180': expanded }" />
      </button>
      <button class="icon-btn" title="编辑备注" @click="editNote(project)"><Pencil class="w-4 h-4" /></button>
    </header>

    <div v-if="expanded" class="border-t border-surface-800 p-3 md:p-4 space-y-3">
      <div class="flex flex-col lg:flex-row lg:items-center gap-2">
        <div class="min-w-0 flex-1">
          <p class="text-muted font-mono break-all">{{ project.workingDir || 'Docker 标签未提供工作目录' }}</p>
          <p v-if="project.note" class="text-sm text-surface-300 border-l-2 border-surface-700 pl-2 mt-2">{{ project.note }}</p>
        </div>
        <span v-if="project.managed" class="count-badge self-start lg:self-auto">{{ project.editable ? 'Compose 模式' : '现有容器模式' }}</span>
      </div>

      <div class="flex flex-wrap gap-1.5">
        <button class="btn-primary" :disabled="!project.managed || locked" :title="project.editable ? '通过 Docker Compose 启动' : '启动项目中已有的容器'" @click="trigger('up')"><Play class="w-4 h-4" :class="{ 'animate-spin': actionRunning === 'up' }" />启动</button>
        <button class="btn-secondary" :disabled="!project.managed || locked" @click="trigger('restart')"><RotateCw class="w-4 h-4" :class="{ 'animate-spin': actionRunning === 'restart' }" />重启</button>
        <button class="btn-danger" :disabled="!project.managed || locked" @click="trigger('stop')"><Square class="w-4 h-4" :class="{ 'animate-spin': actionRunning === 'stop' }" />停止</button>
        <button class="btn-ghost" :disabled="!project.managed || locked" @click="trigger('ps')"><ListTree class="w-4 h-4" />状态</button>
        <button class="btn-secondary" :disabled="!project.editable || locked" title="需在项目纳管中勾选 Compose" @click="trigger('pull')"><Download class="w-4 h-4" :class="{ 'animate-spin': actionRunning === 'pull' }" />拉取</button>
        <router-link class="btn-ghost" :class="{ 'pointer-events-none opacity-40': !project.editable }" :to="`/compose?projectId=${project.id}`"><FileCode2 class="w-4 h-4" />配置</router-link>
        <button class="btn-ghost" :class="{ 'pointer-events-none opacity-40': !project.editable }" :disabled="!project.editable || busy" title="编辑项目环境变量 (.env)" @click="$emit('env')"><KeyRound class="w-4 h-4" />环境变量</button>
        <button class="btn-ghost" :disabled="!project.managed || busy" @click="$emit('activity')"><History class="h-4 w-4" />活动</button>
      </div>

      <div v-if="!project.managed" class="alert-warning flex flex-col sm:flex-row sm:items-center gap-2">
        <span class="flex-1">项目尚未纳管，所有控制与容器入口均已禁用。</span>
        <router-link class="btn-ghost shrink-0" :to="`/settings?tab=mounts&projectId=${project.id}`"><FolderCog class="w-4 h-4" />项目纳管</router-link>
      </div>
      <div v-else-if="!project.editable" class="alert-warning flex flex-col sm:flex-row sm:items-center gap-2">
        <span class="flex-1">当前可控制已有容器；请勾选 Compose 目录并应用挂载，解锁拉取、创建缺失服务和配置编辑。</span>
        <router-link class="btn-ghost shrink-0" :to="`/settings?tab=mounts&projectId=${project.id}`"><FolderCog class="w-4 h-4" />选择 Compose 目录</router-link>
      </div>

      <div class="divide-y divide-surface-800 border-t border-surface-800">
        <div v-for="container in project.containers" :key="container.id" class="min-h-12 py-2 flex items-center gap-2">
          <span class="status-dot" :class="container.state === 'running' ? 'bg-emerald-400' : 'bg-rose-400'"></span>
          <div class="min-w-0 flex-1">
            <div class="text-sm font-mono truncate">{{ container.name }}</div>
            <div class="text-muted truncate">{{ container.image }}<span v-if="container.ports.length"> · {{ portText(container) }}</span><span v-if="container.health" :class="healthClass(container.health)"> · {{ container.health }}</span></div>
          </div>
          <router-link class="icon-btn" :class="{ 'pointer-events-none opacity-40': !project.managed }" title="实时日志" :to="`/logs?projectId=${project.id}&containerId=${container.id}`"><ScrollText class="w-4 h-4" /></router-link>
          <router-link class="icon-btn" :class="{ 'pointer-events-none opacity-40': !project.managed }" title="容器终端" :to="`/shell?projectId=${project.id}&containerId=${container.id}`"><TerminalSquare class="w-4 h-4" /></router-link>
          <router-link class="icon-btn" :class="{ 'pointer-events-none opacity-40': !project.managed }" title="AI 诊断" :to="`/ai?projectId=${project.id}&containerId=${container.id}&diagnose=1`"><Bot class="w-4 h-4" /></router-link>
        </div>
      </div>
    </div>
  </article>
</template>

<script setup>
import { computed } from 'vue';
import { Bot, ChevronDown, Download, FileCode2, FolderCog, History, KeyRound, ListTree, Pencil, Play, RotateCw, ScrollText, Square, Star, TerminalSquare } from 'lucide-vue-next';
import StatusBadge from '../common/StatusBadge.vue';
import { api } from '../../api/client.js';

const props = defineProps({
  project: { type: Object, required: true },
  expanded: Boolean,
  selected: Boolean,
  focused: Boolean,
  busy: Boolean,
  actionRunning: { type: String, default: '' },
  lastResults: { type: Array, default: () => [] },
});
const emit = defineEmits(['toggle-expand', 'toggle-select', 'action', 'activity', 'env', 'refresh']);

const locked = computed(() => props.busy || !!props.actionRunning);
const attention = computed(() => props.project.status !== 'running' || props.project.containers.some((container) => container.health === 'unhealthy'));
const statusDotClass = computed(() => (props.project.status === 'running' ? 'bg-emerald-400' : props.project.status === 'partial' ? 'bg-amber-400' : 'bg-rose-400'));
const imageState = computed(() => {
  const matches = props.lastResults.filter((result) => props.project.containers.some((container) => container.image === result.image));
  if (matches.some((result) => result.status === 'updated' && props.project.containers.some((container) => container.image === result.image && container.imageId !== result.after))) return 'updated';
  if (matches.some((result) => result.status === 'failed')) return 'failed';
  return matches.length ? 'current' : '';
});

function trigger(action) {
  if (!props.project.managed || locked.value) return;
  if (action === 'stop' && !window.confirm(`确认停止 ${props.project.projectName} 中现有的容器？不会删除容器和网络。`)) return;
  emit('action', action);
}
async function toggleFavorite(project) { project.favorite = !project.favorite; await api.saveProjectPreference(project.id, { favorite: project.favorite }); emit('refresh'); }
async function editNote(project) {
  const note = window.prompt('项目备注（最多 500 字）', project.note || '');
  if (note === null) return;
  project.note = note.slice(0, 500); await api.saveProjectPreference(project.id, { note: project.note });
}
function portText(container) { return container.ports.map((port) => `${port.public}:${port.private}`).join(', '); }
function healthClass(health) { return health === 'unhealthy' ? 'text-rose-400' : health === 'healthy' ? 'text-emerald-400' : 'text-amber-400'; }
</script>
