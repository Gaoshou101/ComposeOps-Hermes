<template>
  <div class="page-shell">
    <div class="page-header">
      <div><h1 class="page-title">服务总览</h1><p class="page-subtitle">自动发现 {{ store.projects.length }} 个项目 · 已纳管 {{ managedCount }} 个 · {{ containerCount }} 个容器</p></div>
      <div class="page-actions">
        <label class="toggle-label"><input v-model="autoRefresh" type="checkbox" />自动刷新</label>
        <button class="btn-secondary" :disabled="store.loading" @click="refresh"><RefreshCw class="w-4 h-4" :class="{ 'animate-spin': store.loading }" />刷新</button>
        <button class="icon-btn" title="快捷键速查表(?)" @click="openCheatSheet"><Keyboard class="w-4 h-4" /></button>
      </div>
    </div>
    <p v-if="store.error" class="alert-error">{{ store.error }}</p>
    <div v-if="store.projects.length" class="metric-grid">
      <button class="metric-tile" :class="{ active: filter === 'managed' }" @click="filter = filter === 'managed' ? 'all' : 'managed'"><span class="metric-icon text-blue-300"><Boxes class="h-5 w-5" /></span><span><strong>{{ managedCount }}</strong><small>已纳管项目</small></span><span class="metric-meta">共 {{ store.projects.length }} 个</span></button>
      <button class="metric-tile" :class="{ active: filter === 'running' }" @click="filter = filter === 'running' ? 'all' : 'running'"><span class="metric-icon text-emerald-300"><CircleCheckBig class="h-5 w-5" /></span><span><strong>{{ healthyCount }}</strong><small>健康运行</small></span><span class="metric-meta">项目状态正常</span></button>
      <button class="metric-tile" :class="{ active: filter === 'attention' }" @click="filter = filter === 'attention' ? 'all' : 'attention'"><span class="metric-icon text-amber-300"><AlertTriangle class="h-5 w-5" /></span><span><strong>{{ attentionCount }}</strong><small>需要关注</small></span><span class="metric-meta">停止、部分异常或不健康</span></button>
      <button class="metric-tile" :class="{ active: filter === 'stopped' }" @click="filter = filter === 'stopped' ? 'all' : 'stopped'"><span class="metric-icon text-surface-300"><Container class="h-5 w-5" /></span><span><strong>{{ runningContainerCount }} / {{ containerCount }}</strong><small>运行中容器</small></span><span class="metric-meta">{{ stoppedContainerCount }} 个未运行</span></button>
    </div>
    <div v-if="store.projects.length" class="toolbar-panel">
      <label class="search-field"><Search class="h-4 w-4" /><input v-model="searchQuery" placeholder="搜索项目、容器、镜像或路径" /></label>
      <select v-model="filter" class="input sm:w-40" aria-label="状态筛选"><option value="all">全部项目</option><option value="attention">需要关注</option><option value="running">健康运行</option><option value="stopped">已停止</option><option value="managed">已纳管</option><option value="unmanaged">未纳管</option><option value="favorites">仅收藏</option></select>
      <select v-model="sort" class="input sm:w-40" aria-label="项目排序"><option value="priority">异常与收藏优先</option><option value="name">按项目名称</option><option value="owner">按项目归属</option></select>
      <label class="toggle-label whitespace-nowrap"><input type="checkbox" :checked="allVisibleSelected" :disabled="!visibleManagedProjects.length" @change="toggleAllVisible" />选择当前</label>
      <span class="ml-auto whitespace-nowrap text-muted">显示 {{ visibleProjects.length }} / {{ store.projects.length }}</span>
    </div>
    <BatchOperationsBar v-if="selectedProjects.length" :selected-count="selectedProjects.length" :busy="busy" @run="runBatch" @clear="selectedIds = []" />
    <Skeleton v-if="store.loading && !store.projects.length" variant="cards" :rows="4" label="服务列表加载中" class="flex-1" />
    <EmptyState v-else-if="!store.projects.length" icon="Boxes" title="暂未发现 Compose 项目" description="Docker 中没有带 Compose 标签的项目,或尚未扫描" />
    <EmptyState v-else-if="!visibleProjects.length" icon="Search" title="没有匹配当前条件的项目" description="调整搜索关键词或筛选条件后重试" action-label="清除筛选" class="flex-1" @action="resetFilters" />
    <div v-else class="flex-1 space-y-3">
      <ServiceProjectCard
        v-for="project in visibleProjects" :key="project.id" :project="project"
        :expanded="expandedIds.has(project.id)" :selected="selectedIds.includes(project.id)" :focused="route.query.focus === project.id || kbFocusId === project.id"
        :busy="busy" :last-results="updateSettings.lastResults" :action-running="project.id === runningAction.id ? runningAction.action : ''"
        @toggle-expand="toggleExpanded(project.id)" @toggle-select="toggleSelection(project.id)" @refresh="refresh" @activity="activityProject = project" @env="envProject = project" @upgrade="upgradeProject = project" @db-dump="dbDumpProject = project" @action="(action) => run(project, action)"
      />
    </div>
    <OperationOutputDrawer v-if="output.open" :label="actionLabel(output.action)" :name="output.name" :text="output.text" :project-id="output.projectId" :exit-code="output.exitCode" :running="output.running" :batch-tasks="batchTasks" :batch-progress="batchProgress" :completed-count="completedBatchTasks" @close="output.open = false" @diagnose="openDiagnosisForOutput" />
    <ProjectEnvModal v-if="envProject" :project="envProject" @close="closeEnv" @refresh="refresh" @apply="handleEnvApply" />
    <AIDiagnosisModal v-if="diagnosis" :open="!!diagnosis" :project-id="diagnosis.projectId" :project-name="diagnosis.projectName" :container-id="diagnosis.containerId" :raw-logs="diagnosis.rawLogs" :env-keys="diagnosis.envKeys" :failed-command="diagnosis.failedCommand" :exit-code="diagnosis.exitCode" :env-editable="diagnosis.envEditable" @close="diagnosis = null" />
    <ProjectActivityDrawer v-if="activityProject" :project="activityProject" @close="activityProject = null" @restored="handleRestored" />
    <ProjectUpgradeModal v-if="upgradeProject" :project="upgradeProject" :open="!!upgradeProject" @close="upgradeProject = null" @upgrade="handleUpgrade" />
    <DbDumpModal v-if="dbDumpProject" :project="dbDumpProject" @close="dbDumpProject = null" />
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { AlertTriangle, Boxes, CircleCheckBig, Container, Keyboard, RefreshCw, Search } from 'lucide-vue-next';
import { useServicesStore } from '../stores/services.js';
import { useToastStore } from '../stores/toast.js';
import { useKeyboardNavigation } from '../composables/useKeyboardNavigation.js';
import { api, streamComposeControl } from '../api/client.js';
import ProjectActivityDrawer from '../components/ProjectActivityDrawer.vue';
import ProjectEnvModal from '../components/services/ProjectEnvModal.vue';
import ServiceProjectCard from '../components/services/ServiceProjectCard.vue';
import AIDiagnosisModal from '../components/services/AIDiagnosisModal.vue';
import ProjectUpgradeModal from '../components/services/ProjectUpgradeModal.vue';
import DbDumpModal from '../components/services/DbDumpModal.vue';
import BatchOperationsBar from '../components/services/BatchOperationsBar.vue';
import OperationOutputDrawer from '../components/services/OperationOutputDrawer.vue';
import EmptyState from '../components/common/EmptyState.vue';
import Skeleton from '../components/common/Skeleton.vue';

const store = useServicesStore();
const route = useRoute();
const router = useRouter();
const autoRefresh = ref(true); const busy = ref(false); const expandedIds = ref(new Set());
const searchQuery = ref(''); const filter = ref('all'); const sort = ref('priority');
const selectedIds = ref([]); const updateSettings = ref({ lastResults: [] }); const focusedProject = ref('');
const batchTasks = ref([]); const activityProject = ref(null); const envProject = ref(null); const diagnosis = ref(null); const upgradeProject = ref(null); const dbDumpProject = ref(null); const runningAction = ref({ id: '', action: '' }); const kbFocusId = ref('');
let jobPollTimer; let activeJobId = ''; let jobPollInFlight = false;
const output = reactive({ open: false, text: '', action: '', name: '', projectId: '', exitCode: null, running: false });
const containerCount = computed(() => store.projects.reduce((count, project) => count + project.containers.length, 0));
const managedCount = computed(() => store.projects.filter((project) => project.managed).length);
const runningContainerCount = computed(() => store.projects.reduce((count, project) => count + project.containers.filter((container) => container.state === 'running').length, 0));
const stoppedContainerCount = computed(() => containerCount.value - runningContainerCount.value);
const healthyCount = computed(() => store.projects.filter((project) => !hasAttention(project)).length);
const attentionCount = computed(() => store.projects.filter(hasAttention).length);
const visibleProjects = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  const matcher = statusMatchers[filter.value];
  const matches = store.projects.filter((project) => (!matcher || matcher(project)) && (!query || searchIndex(project).includes(query)));
  return [...matches].sort(sortComparators[sort.value]);
});
const visibleManagedProjects = computed(() => visibleProjects.value.filter((project) => project.managed));
const selectedProjects = computed(() => store.projects.filter((project) => selectedIds.value.includes(project.id) && project.managed));
const allVisibleSelected = computed(() => visibleManagedProjects.value.length > 0 && visibleManagedProjects.value.every((project) => selectedIds.value.includes(project.id)));
const completedBatchTasks = computed(() => batchTasks.value.filter((task) => ['success', 'failed'].includes(task.status)).length);
const batchProgress = computed(() => batchTasks.value.length ? Math.round(completedBatchTasks.value / batchTasks.value.length * 100) : 0);

function refresh() { return store.refresh(); }
function hasAttention(project) { return project.status !== 'running' || project.containers.some((container) => container.health === 'unhealthy'); }
function searchIndex(project) { return [project.projectName, project.owner, project.workingDir, project.note, ...project.containers.flatMap((container) => [container.name, container.image])].join(' ').toLowerCase(); }
const statusMatchers = { attention: (p) => hasAttention(p), running: (p) => !hasAttention(p), managed: (p) => p.managed, unmanaged: (p) => !p.managed, favorites: (p) => p.favorite, stopped: (p) => p.containers.some((c) => c.state !== 'running') };
const sortComparators = { name: (a, b) => a.projectName.localeCompare(b.projectName), owner: (a, b) => a.owner.localeCompare(b.owner) || a.projectName.localeCompare(b.projectName), priority: (a, b) => Number(hasAttention(b)) - Number(hasAttention(a)) || Number(b.favorite) - Number(a.favorite) || Number(b.managed) - Number(a.managed) || a.projectName.localeCompare(b.projectName) };
function resetFilters() { searchQuery.value = ''; filter.value = 'all'; sort.value = 'priority'; }
function toggleSelection(projectId) { selectedIds.value = selectedIds.value.includes(projectId) ? selectedIds.value.filter((id) => id !== projectId) : [...selectedIds.value, projectId]; }
function toggleAllVisible() { const visibleIds = visibleManagedProjects.value.map((project) => project.id); selectedIds.value = allVisibleSelected.value ? selectedIds.value.filter((id) => !visibleIds.includes(id)) : [...new Set([...selectedIds.value, ...visibleIds])]; }
function toggleExpanded(projectId) { const next = new Set(expandedIds.value); if (next.has(projectId)) next.delete(projectId); else next.add(projectId); expandedIds.value = next; }
function actionLabel(action) { return ({ up: '启动', restart: '重启', stop: '停止', pull: '拉取', ps: '状态', 'env.apply': '应用环境变量', 'env.save': '保存环境变量' })[action] || action; }
async function run(project, action) {
  clearTimeout(jobPollTimer);
  activeJobId = '';
  runningAction.value = { id: project.id, action };
  busy.value = true; batchTasks.value = []; output.open = true; output.text = ''; output.action = action; output.name = project.projectName; output.projectId = project.id; output.exitCode = null; output.running = true;
  try {
    await streamComposeControl(project.id, action, (frame) => {
      if (frame.type === 'stdout' || frame.type === 'stderr') output.text += frame.data;
      else if (frame.type === 'error') output.text += `\n[错误] ${frame.data}`;
      else if (frame.type === 'exit') { output.exitCode = frame.data.code; output.text += `\n[退出码 ${frame.data.code}]`; }
    });
    await refresh();
  } catch (error) { output.text += `\n[请求失败] ${error.message}`; output.exitCode = 1; }
  finally { busy.value = false; runningAction.value = { id: '', action: '' }; output.running = false; }
}
async function handleEnvApply({ project }) {
  envProject.value = null;
  output.open = true; output.text = ''; output.action = 'env.apply'; output.name = project.projectName; output.projectId = project.id; output.exitCode = null; output.running = true;
  busy.value = true;
  try {
    await streamComposeControl(project.id, null, (frame) => {
      if (frame.type === 'stdout' || frame.type === 'stderr') output.text += frame.data;
      else if (frame.type === 'error') output.text += `\n[错误] ${frame.data}`;
      else if (frame.type === 'exit') { output.exitCode = frame.data.code; output.text += `\n[退出码 ${frame.data.code}]`; }
    }, `/projects/${project.id}/env/apply`, { restart: true });
    useToastStore().success('环境变量已应用,容器平滑重建完成');
    await refresh();
  } catch (error) {
    output.text += `\n[请求失败] ${error.message}`; output.exitCode = 1;
  } finally { busy.value = false; output.running = false; }
}
async function handleUpgrade(project) {
  upgradeProject.value = null;
  output.open = true; output.text = ''; output.action = 'images.upgrade'; output.name = project.projectName; output.projectId = project.id; output.exitCode = null; output.running = true;
  busy.value = true;
  try {
    await api.streamUpgrade(project.id, (frame) => {
      if (frame.type === 'stdout' || frame.type === 'stderr') output.text += frame.data;
      else if (frame.type === 'error') output.text += `\n[错误] ${frame.data}`;
      else if (frame.type === 'exit') { output.exitCode = frame.data.code; output.text += `\n[退出码 ${frame.data.code}]`; }
      else if (frame.type === 'result') {
        if (frame.data?.degraded) output.text += `\n[升级后容器未通过健康检查,可在活动/备份中回滚]`;
      }
    });
    useToastStore().success('镜像升级完成');
    store.refresh();
  } catch (error) {
    output.text += `\n[请求失败] ${error.message}`; output.exitCode = 1;
  } finally { busy.value = false; output.running = false; }
}
function openDiagnosisForOutput() {
  const project = store.projects.find((p) => p.id === output.projectId);
  if (!project) return;
  diagnosis.value = {
    projectId: project.id,
    projectName: project.projectName,
    containerId: '',
    rawLogs: output.text.slice(-50000),
    envKeys: [],
    failedCommand: output.action ? `docker compose ${output.action}` : 'docker compose up -d --force-recreate',
    exitCode: output.exitCode,
    envEditable: !!project.editable,
  };
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
  activeJobId = jobId; jobPollInFlight = true;
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
  if (!expandedIds.value.has(projectId)) toggleExpanded(projectId);
  await nextTick(); document.getElementById(`project-${projectId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function closeEnv() {
  envProject.value = null;
  if (route.query.env) {
    const next = { ...route.query };
    delete next.env;
    router.replace({ query: next });
  }
}
async function openEnvFromQuery() {
  const projectId = String(route.query.env || '');
  if (!projectId || envProject.value?.id === projectId) return;
  const project = store.projects.find((p) => p.id === projectId);
  if (!project) return;
  envProject.value = project;
}
watch(() => route.query.env, openEnvFromQuery);
watch(autoRefresh, async (value) => { if (!value) return store.stopAutoRefresh(); const preferences = await api.getPreferences(); store.startAutoRefresh(preferences.refreshInterval * 1000); });
watch([() => route.query.focus, () => store.projects], focusProject, { deep: true });
onMounted(async () => { const [preferences, updates] = await Promise.all([api.getPreferences(), api.getUpdateSettings()]); updateSettings.value = updates; store.startAutoRefresh(preferences.refreshInterval * 1000); if (route.query.job) void pollJob(String(route.query.job)); void openEnvFromQuery(); });
watch(() => route.query.job, (job) => { if (job) void pollJob(String(job)); else { activeJobId = ''; clearTimeout(jobPollTimer); } });
watch(kbFocusId, (id) => {
  if (!id) return;
  nextTick(() => { document.getElementById(`project-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
});
useKeyboardNavigation({
  enabled: computed(() => route.name === 'services' && !envProject.value && !dbDumpProject.value && !upgradeProject.value && !activityProject.value && !diagnosis.value),
  onCheatSheet: () => { window.dispatchEvent(new CustomEvent('composeops:open-cheatsheet')); },
  getProjectIds: () => visibleProjects.value.map((project) => project.id),
  onMove: (id) => { kbFocusId.value = id; },
  onAction: (action) => handleKbAction(action),
});
function openCheatSheet() { window.dispatchEvent(new CustomEvent('composeops:open-cheatsheet')); }
async function handleKbAction(action) {
  const project = store.projects.find((p) => p.id === kbFocusId.value);
  if (!project) return;
  if (action === 'expand') { toggleExpanded(project.id); return; }
  if (action === 'l') { router.push({ path: '/logs', query: { projectId: project.id } }); return; }
  if (action === 'e') { envProject.value = project; return; }
  if (action === 'c') { router.push({ path: '/compose', query: { projectId: project.id } }); return; }
  if (action === 'r') {
    if (!window.confirm(`确认重启 ${project.projectName}?`)) return;
    void run(project, 'restart');
    return;
  }
  if (action === 'w') {
    try {
      const data = await api.getProjectWebUi(project.id);
      const url = data?.links?.[0]?.ports?.[0]?.url;
      if (url) window.open(url, '_blank', 'noopener');
      else useToastStore().info('该项目没有可直达的 WebUI 端口');
    } catch { useToastStore().error('WebUI 检测失败'); }
  }
}
function handleRestored() {
  activityProject.value = null;
  refresh();
  useToastStore().success('配置版本已成功回滚并生效');
}
onUnmounted(() => { activeJobId = ''; clearTimeout(jobPollTimer); store.stopAutoRefresh(); });
</script>
