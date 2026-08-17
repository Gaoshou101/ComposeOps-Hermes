<template>
  <div class="page-shell">
    <div class="page-header">
      <div><h1 class="page-title">服务总览</h1><p class="page-subtitle">自动发现 {{ store.projects.length }} 个项目 · 已纳管 {{ managedCount }} 个 · {{ containerCount }} 个容器</p></div>
      <div class="page-actions">
        <label class="toggle-label"><input v-model="autoRefresh" type="checkbox" />自动刷新</label>
        <button class="btn-secondary" :disabled="store.loading" @click="refresh"><RefreshCw class="w-4 h-4" :class="{ 'animate-spin': store.loading }" />刷新</button>
      </div>
    </div>

    <p v-if="store.error" class="alert-error">{{ store.error }}</p>
    <div v-if="store.projects.length" class="metric-grid">
      <button class="metric-tile" :class="{ active: filter === 'managed' }" @click="filter = filter === 'managed' ? 'all' : 'managed'">
        <span class="metric-icon text-blue-300"><Boxes class="h-5 w-5" /></span>
        <span><strong>{{ managedCount }}</strong><small>已纳管项目</small></span>
        <span class="metric-meta">共 {{ store.projects.length }} 个</span>
      </button>
      <button class="metric-tile" :class="{ active: filter === 'running' }" @click="filter = filter === 'running' ? 'all' : 'running'">
        <span class="metric-icon text-emerald-300"><CircleCheckBig class="h-5 w-5" /></span>
        <span><strong>{{ healthyCount }}</strong><small>健康运行</small></span>
        <span class="metric-meta">项目状态正常</span>
      </button>
      <button class="metric-tile" :class="{ active: filter === 'attention' }" @click="filter = filter === 'attention' ? 'all' : 'attention'">
        <span class="metric-icon text-amber-300"><AlertTriangle class="h-5 w-5" /></span>
        <span><strong>{{ attentionCount }}</strong><small>需要关注</small></span>
        <span class="metric-meta">停止、部分异常或不健康</span>
      </button>
      <button class="metric-tile" :class="{ active: filter === 'stopped' }" @click="filter = filter === 'stopped' ? 'all' : 'stopped'">
        <span class="metric-icon text-surface-300"><Container class="h-5 w-5" /></span>
        <span><strong>{{ runningContainerCount }} / {{ containerCount }}</strong><small>运行中容器</small></span>
        <span class="metric-meta">{{ stoppedContainerCount }} 个未运行</span>
      </button>
    </div>

    <div v-if="store.projects.length" class="toolbar-panel">
      <label class="search-field">
        <Search class="h-4 w-4" />
        <input v-model="searchQuery" placeholder="搜索项目、容器、镜像或路径" />
      </label>
      <select v-model="filter" class="input sm:w-40" aria-label="状态筛选">
        <option value="all">全部项目</option>
        <option value="attention">需要关注</option>
        <option value="running">健康运行</option>
        <option value="stopped">已停止</option>
        <option value="managed">已纳管</option>
        <option value="unmanaged">未纳管</option>
        <option value="favorites">仅收藏</option>
      </select>
      <select v-model="sort" class="input sm:w-40" aria-label="项目排序">
        <option value="priority">异常与收藏优先</option>
        <option value="name">按项目名称</option>
        <option value="owner">按项目归属</option>
      </select>
      <label class="toggle-label whitespace-nowrap"><input type="checkbox" :checked="allVisibleSelected" :disabled="!visibleManagedProjects.length" @change="toggleAllVisible" />选择当前</label>
      <span class="ml-auto whitespace-nowrap text-xs text-surface-500">显示 {{ visibleProjects.length }} / {{ store.projects.length }}</span>
    </div>
    <div v-if="selectedProjects.length" class="bulk-bar">
      <div class="flex min-w-0 items-center gap-2"><CheckSquare2 class="h-4 w-4 text-accent" /><span class="text-sm font-medium">已选择 {{ selectedProjects.length }} 个项目</span><span class="hidden text-xs text-surface-500 sm:inline">批量操作将按顺序执行</span></div>
      <div class="flex flex-wrap gap-2 sm:ml-auto">
        <button class="btn-primary" :disabled="busy" @click="runBatch('up')"><Play class="h-4 w-4" />启动</button>
        <button class="btn-secondary" :disabled="busy" @click="runBatch('restart')"><RotateCw class="h-4 w-4" />重启</button>
        <button class="btn-danger" :disabled="busy" @click="runBatch('stop')"><Square class="h-4 w-4" />停止</button>
        <button class="btn-ghost" @click="selectedIds = []">取消选择</button>
      </div>
    </div>
    <div v-if="!store.projects.length && !store.loading" class="empty-state"><Boxes class="w-8 h-8" /><span>暂未发现 Compose 项目</span></div>
    <div v-else-if="!visibleProjects.length" class="empty-state flex-1">
      <Search class="h-8 w-8" />
      <span>没有匹配当前条件的项目</span>
      <button class="btn-secondary" @click="resetFilters">清除筛选</button>
    </div>

    <div v-else class="flex-1 space-y-3">
      <article :id="`project-${project.id}`" v-for="project in visibleProjects" :key="project.id" class="card overflow-hidden" :class="{ 'project-attention': hasAttention(project), 'ring-1 ring-accent': route.query.focus === project.id }">
        <header class="min-h-16 flex items-center gap-1 px-2 md:px-4">
          <input type="checkbox" class="ml-2 accent-accent" :checked="selectedIds.includes(project.id)" :disabled="!project.managed || busy" :aria-label="`选择 ${project.projectName}`" @click.stop @change="toggleSelection(project.id)" />
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
            <span v-if="projectImageState(project) === 'updated'" class="count-badge shrink-0 bg-amber-950/50 text-amber-300">镜像待应用</span>
            <span v-else-if="projectImageState(project) === 'failed'" class="count-badge hidden shrink-0 bg-red-950/50 text-red-300 lg:inline">镜像检查失败</span>
            <span v-else-if="projectImageState(project) === 'current'" class="count-badge hidden shrink-0 text-green-300 xl:inline">镜像已检查</span>
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
            <span v-if="project.managed" class="count-badge self-start lg:self-auto">{{ project.editable ? 'Compose 模式' : '现有容器模式' }}</span>
          </div>

          <div class="flex flex-wrap gap-1.5">
            <button class="btn-primary" :disabled="!project.managed || busy" :title="project.editable ? '通过 Docker Compose 启动' : '启动项目中已有的容器'" @click="run(project, 'up')"><Play class="w-4 h-4" />启动</button>
            <button class="btn-secondary" :disabled="!project.managed || busy" @click="run(project, 'restart')"><RotateCw class="w-4 h-4" />重启</button>
            <button class="btn-danger" :disabled="!project.managed || busy" @click="confirmStop(project)"><Square class="w-4 h-4" />停止</button>
            <button class="btn-ghost" :disabled="!project.managed || busy" @click="run(project, 'ps')"><ListTree class="w-4 h-4" />状态</button>
            <button class="btn-secondary" :disabled="!project.editable || busy" title="需在项目纳管中勾选 Compose" @click="run(project, 'pull')"><Download class="w-4 h-4" />拉取</button>
            <router-link class="btn-ghost" :class="{ 'pointer-events-none opacity-40': !project.editable }" :to="`/compose?projectId=${project.id}`"><FileCode2 class="w-4 h-4" />配置</router-link>
            <button class="btn-ghost" :disabled="!project.managed" @click="activityProject = project"><History class="h-4 w-4" />活动</button>
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
              <span class="status-dot" :class="container.state === 'running' ? 'bg-green-400' : 'bg-red-400'"></span>
              <div class="min-w-0 flex-1">
                <div class="text-sm font-mono truncate">{{ container.name }}</div>
                <div class="text-xs text-surface-500 truncate">{{ container.image }}<span v-if="container.ports.length"> · {{ portText(container) }}</span><span v-if="container.health" :class="container.health === 'unhealthy' ? 'text-red-400' : container.health === 'healthy' ? 'text-green-400' : 'text-amber-400'"> · {{ container.health }}</span></div>
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
      <div v-if="batchTasks.length" class="border-b border-surface-800 p-3">
        <div class="mb-2 flex items-center justify-between text-xs text-surface-500"><span>任务进度</span><span>{{ completedBatchTasks }} / {{ batchTasks.length }}</span></div>
        <div class="progress mb-3"><span :style="{ width: `${batchProgress}%` }"></span></div>
        <div class="grid gap-2 sm:grid-cols-2">
          <div v-for="task in batchTasks" :key="task.id" class="batch-task">
            <LoaderCircle v-if="task.status === 'running'" class="h-4 w-4 animate-spin text-accent" />
            <CircleCheck v-else-if="task.status === 'success'" class="h-4 w-4 text-green-400" />
            <CircleX v-else-if="task.status === 'failed'" class="h-4 w-4 text-red-400" />
            <span v-else class="h-2 w-2 rounded-full bg-surface-600"></span>
            <span class="min-w-0 flex-1 truncate text-xs">{{ task.name }}</span>
            <span class="text-[10px] text-surface-500">{{ batchStatusLabel(task.status) }}</span>
          </div>
        </div>
      </div>
      <pre class="terminal-output flex-1">{{ output.text }}</pre>
    </div>
    <ProjectActivityDrawer v-if="activityProject" :project="activityProject" @close="activityProject = null" @restored="refresh" />
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { AlertTriangle, Bot, Boxes, CheckSquare2, ChevronDown, CircleCheck, CircleCheckBig, CircleX, Container, Download, FileCode2, FolderCog, History, ListTree, LoaderCircle, Pencil, Play, RefreshCw, RotateCw, ScrollText, Search, Square, Star, TerminalSquare, X } from 'lucide-vue-next';
import { useServicesStore } from '../stores/services.js';
import { api, streamComposeControl } from '../api/client.js';
import ProjectActivityDrawer from '../components/ProjectActivityDrawer.vue';
import StatusBadge from '../components/StatusBadge.vue';

const store = useServicesStore();
const route = useRoute();
const router = useRouter();
const autoRefresh = ref(true); const busy = ref(false); const expandedIds = ref(new Set());
const searchQuery = ref(''); const filter = ref('all'); const sort = ref('priority');
const selectedIds = ref([]); const updateSettings = ref({ lastResults: [] }); const focusedProject = ref('');
const batchTasks = ref([]); const activityProject = ref(null);
let jobPollTimer;
let activeJobId = '';
let jobPollInFlight = false;
const output = reactive({ open: false, text: '', action: '', name: '' });
const containerCount = computed(() => store.projects.reduce((count, project) => count + project.containers.length, 0));
const managedCount = computed(() => store.projects.filter((project) => project.managed).length);
const runningContainerCount = computed(() => store.projects.reduce((count, project) => count + project.containers.filter((container) => container.state === 'running').length, 0));
const stoppedContainerCount = computed(() => containerCount.value - runningContainerCount.value);
const healthyCount = computed(() => store.projects.filter((project) => !hasAttention(project)).length);
const attentionCount = computed(() => store.projects.filter(hasAttention).length);
const visibleProjects = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  const matches = store.projects.filter((project) => {
    if (filter.value === 'attention' && !hasAttention(project)) return false;
    if (filter.value === 'running' && hasAttention(project)) return false;
    if (filter.value === 'stopped' && !project.containers.some((container) => container.state !== 'running')) return false;
    if (filter.value === 'managed' && !project.managed) return false;
    if (filter.value === 'unmanaged' && project.managed) return false;
    if (filter.value === 'favorites' && !project.favorite) return false;
    if (!query) return true;
    const text = [project.projectName, project.owner, project.workingDir, project.note, ...project.containers.flatMap((container) => [container.name, container.image])].join(' ').toLowerCase();
    return text.includes(query);
  });
  return [...matches].sort((a, b) => {
    if (sort.value === 'name') return a.projectName.localeCompare(b.projectName);
    if (sort.value === 'owner') return a.owner.localeCompare(b.owner) || a.projectName.localeCompare(b.projectName);
    return Number(hasAttention(b)) - Number(hasAttention(a)) || Number(b.favorite) - Number(a.favorite) || Number(b.managed) - Number(a.managed) || a.projectName.localeCompare(b.projectName);
  });
});
const visibleManagedProjects = computed(() => visibleProjects.value.filter((project) => project.managed));
const selectedProjects = computed(() => store.projects.filter((project) => selectedIds.value.includes(project.id) && project.managed));
const allVisibleSelected = computed(() => visibleManagedProjects.value.length > 0 && visibleManagedProjects.value.every((project) => selectedIds.value.includes(project.id)));
const completedBatchTasks = computed(() => batchTasks.value.filter((task) => ['success', 'failed'].includes(task.status)).length);
const batchProgress = computed(() => batchTasks.value.length ? Math.round(completedBatchTasks.value / batchTasks.value.length * 100) : 0);

function refresh() { return store.refresh(); }
function hasAttention(project) { return project.status !== 'running' || project.containers.some((container) => container.health === 'unhealthy'); }
function resetFilters() { searchQuery.value = ''; filter.value = 'all'; sort.value = 'priority'; }
function toggleSelection(projectId) { selectedIds.value = selectedIds.value.includes(projectId) ? selectedIds.value.filter((id) => id !== projectId) : [...selectedIds.value, projectId]; }
function toggleAllVisible() {
  const visibleIds = visibleManagedProjects.value.map((project) => project.id);
  selectedIds.value = allVisibleSelected.value ? selectedIds.value.filter((id) => !visibleIds.includes(id)) : [...new Set([...selectedIds.value, ...visibleIds])];
}
function projectImageState(project) {
  const results = updateSettings.value.lastResults || [];
  const matches = results.filter((result) => project.containers.some((container) => container.image === result.image));
  if (matches.some((result) => result.status === 'updated' && project.containers.some((container) => container.image === result.image && container.imageId !== result.after))) return 'updated';
  if (matches.some((result) => result.status === 'failed')) return 'failed';
  return matches.length ? 'current' : '';
}
function isExpanded(projectId) { return expandedIds.value.has(projectId); }
function toggleExpanded(projectId) { const next = new Set(expandedIds.value); if (next.has(projectId)) next.delete(projectId); else next.add(projectId); expandedIds.value = next; }
function portText(container) { return container.ports.map((port) => `${port.public}:${port.private}`).join(', '); }
function actionLabel(action) { return ({ up: '启动', restart: '重启', stop: '停止', pull: '拉取', ps: '状态' })[action] || action; }
function batchStatusLabel(status) { return ({ pending: '等待', running: '执行中', success: '成功', failed: '失败' })[status] || status; }
async function toggleFavorite(project) { project.favorite = !project.favorite; await api.saveProjectPreference(project.id, { favorite: project.favorite }); await refresh(); }
async function editNote(project) {
  const note = window.prompt('项目备注（最多 500 字）', project.note || '');
  if (note === null) return;
  project.note = note.slice(0, 500); await api.saveProjectPreference(project.id, { note: project.note });
}
function confirmStop(project) { if (window.confirm(`确认停止 ${project.projectName} 中现有的容器？不会删除容器和网络。`)) run(project, 'stop'); }
async function run(project, action) {
  clearTimeout(jobPollTimer);
  activeJobId = '';
  busy.value = true; batchTasks.value = []; output.open = true; output.text = ''; output.action = action; output.name = project.projectName;
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
async function runBatch(action) {
  const projects = selectedProjects.value;
  if (!projects.length) return;
  if ((action === 'stop' || action === 'restart') && !window.confirm(`确认对 ${projects.length} 个项目执行${actionLabel(action)}？`)) return;
  busy.value = true; output.open = true; output.text = ''; output.action = action; output.name = `${projects.length} 个项目`;
  try {
    const job = await api.createProjectBatchJob(projects.map((project) => project.id), action);
    router.replace({ query: { ...route.query, job: job.id } });
    await pollJob(job.id);
  } catch (error) { output.text = `[任务创建失败] ${error.message}`; busy.value = false; }
}
function applyJob(job) {
  output.open = true; output.action = job.action; output.name = `${job.total} 个项目`;
  batchTasks.value = job.items.map((item) => ({ id: item.id, name: item.projectName, status: item.status }));
  output.text = job.items.map((item) => `\n\n===== ${item.projectName} =====\n${item.output || ''}`).join('');
  busy.value = ['queued', 'running'].includes(job.status);
  if (!busy.value) { selectedIds.value = []; refresh(); }
}
async function pollJob(jobId) {
  if (jobPollInFlight && activeJobId === jobId) return;
  clearTimeout(jobPollTimer);
  activeJobId = jobId;
  jobPollInFlight = true;
  try {
    const job = await api.getJob(jobId);
    if (activeJobId !== jobId) return;
    applyJob(job);
  } catch (error) { output.text += `\n[任务读取失败] ${error.message}`; busy.value = false; }
  finally { if (activeJobId === jobId) jobPollInFlight = false; }
  if (busy.value && activeJobId === jobId) jobPollTimer = setTimeout(() => void pollJob(jobId), 900);
}
async function focusProject() {
  const projectId = String(route.query.focus || '');
  if (!projectId || focusedProject.value === projectId || !store.projects.some((project) => project.id === projectId)) return;
  focusedProject.value = projectId; searchQuery.value = ''; filter.value = 'all';
  const next = new Set(expandedIds.value); next.add(projectId); expandedIds.value = next;
  await nextTick(); document.getElementById(`project-${projectId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
watch(autoRefresh, async (value) => { if (!value) return store.stopAutoRefresh(); const preferences = await api.getPreferences(); store.startAutoRefresh(preferences.refreshInterval * 1000); });
watch([() => route.query.focus, () => store.projects], focusProject, { deep: true });
onMounted(async () => { const [preferences, updates] = await Promise.all([api.getPreferences(), api.getUpdateSettings()]); updateSettings.value = updates; store.startAutoRefresh(preferences.refreshInterval * 1000); });
onMounted(() => { if (route.query.job) void pollJob(String(route.query.job)); });
watch(() => route.query.job, (job) => {
  if (job) void pollJob(String(job));
  else { activeJobId = ''; clearTimeout(jobPollTimer); }
});
onUnmounted(() => { activeJobId = ''; clearTimeout(jobPollTimer); store.stopAutoRefresh(); });
</script>
