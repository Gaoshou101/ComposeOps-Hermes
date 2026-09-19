<template>
  <header class="app-header h-16 flex items-center justify-between gap-2 px-3 sm:px-6 shrink-0">
    <div class="flex min-w-0 items-center gap-2 sm:gap-3">
      <div class="brand-mark shrink-0"><Boxes class="w-5 h-5" /></div>
      <div class="brand-text min-w-0">
        <span class="brand-title block max-w-36 truncate text-sm sm:text-base font-semibold tracking-tight">ComposeOps</span>
        <p class="text-muted truncate">{{ currentPage }}</p>
      </div>
    </div>
    <div class="flex shrink-0 items-center gap-1.5 sm:gap-3 text-sm">
      <button class="command-trigger hidden sm:inline-flex" title="快速跳转" aria-label="打开快速跳转" @click="commandOpen = true">
        <Search class="h-4 w-4" />
        <span class="hidden md:inline">快速跳转</span>
      </button>
      <button class="icon-btn sm:hidden" title="快速跳转" aria-label="打开快速跳转" @click="commandOpen = true">
        <Search class="h-4 w-4" />
      </button>
      <span v-if="backendOnline" class="status-pill text-emerald-300 hidden md:inline-flex">
        <span class="status-ping bg-emerald-400"></span><span class="hidden sm:inline">服务正常</span>
      </span>
      <span v-else class="status-pill text-rose-300 md:inline-flex hidden">
        <span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span><span class="hidden sm:inline">服务离线</span>
      </span>
      <div class="relative">
        <button class="btn-secondary !min-h-8 !px-2.5 !py-1 text-xs" title="快速切换项目" aria-label="快速切换项目" @click="projectSwitcherOpen = !projectSwitcherOpen">
          <Layers class="w-3.5 h-3.5" /><span class="hidden md:inline">项目</span>
          <ChevronDown class="w-3 h-3" />
        </button>
        <div v-if="projectSwitcherOpen" class="command-backdrop" @click.self="projectSwitcherOpen = false"></div>
        <div v-if="projectSwitcherOpen" class="absolute right-0 top-full mt-2 w-64 overflow-hidden rounded-xl border border-surface-800 bg-surface-950 shadow-2xl z-[60]">
          <div class="border-b border-surface-800 px-3 py-2 text-xs font-semibold text-surface-300">快速切换项目</div>
          <div class="max-h-80 overflow-y-auto p-1.5">
            <button v-for="p in quickProjects" :key="p.id" class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-surface-800/60" @click="goProject(p)">
              <span class="status-dot shrink-0" :class="p.status === 'running' ? 'bg-emerald-400' : p.status === 'partial' ? 'bg-amber-400' : 'bg-rose-400'"></span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-mono text-surface-200">{{ p.projectName }}</span>
                <span class="block truncate text-[10px] text-surface-500">{{ p.owner }} · {{ p.containers.length }} 容器</span>
              </span>
              <span v-if="p.managed" class="count-badge shrink-0 text-[9px] text-emerald-300">纳管</span>
            </button>
            <p v-if="!quickProjects.length" class="px-2 py-4 text-center text-xs text-surface-600">暂无项目</p>
          </div>
        </div>
      </div>
      <HostSwitcher />
      <EventCenter />
      <button class="icon-btn" title="打开页面 Agent" aria-label="打开页面 Agent" @click="emitAgentOpen"><Bot class="w-4 h-4 text-cyan-300" /></button>
      <button class="icon-btn hidden sm:inline-flex header-density" :title="density === 'compact' ? '切换为舒适视图' : '切换为紧凑视图'" aria-label="视图密度" @click="toggleDensity"><Rows3 class="w-4 h-4" /></button>
      <span class="hidden lg:inline text-muted">{{ currentTime }}</span>
      <span class="hidden sm:inline h-5 w-px bg-surface-800"></span>
      <button class="icon-btn" title="退出登录" aria-label="退出登录" @click="$emit('logout')"><LogOut class="w-4 h-4" /></button>
    </div>
  </header>

  <div v-if="commandOpen" class="command-backdrop" @click.self="closeCommand">
    <div class="command-dialog" role="dialog" aria-modal="true" aria-label="快速跳转">
      <div class="command-search">
        <Search class="h-5 w-5 shrink-0 text-surface-500" />
        <input
          ref="commandInput"
          v-model="commandQuery"
          placeholder="搜索页面或功能..."
          @keydown.down.prevent="moveSelection(1)"
          @keydown.up.prevent="moveSelection(-1)"
          @keydown.enter.prevent="runSelected"
          @keydown.esc="closeCommand"
        />
        <button class="icon-btn" title="关闭" aria-label="关闭快速跳转" @click="closeCommand"><X class="h-4 w-4" /></button>
      </div>
      <div class="command-results">
        <p class="command-section-label">页面与工具</p>
        <button
          v-for="(item, index) in filteredCommands"
          :key="item.label"
          class="command-item"
          :class="{ active: selectedCommand === index }"
          @mouseenter="selectedCommand = index"
          @click="runCommand(item)"
        >
          <span class="command-icon"><component :is="item.icon" class="h-4 w-4" /></span>
          <span class="min-w-0 flex-1 text-left">
            <span class="block text-sm text-surface-100">{{ item.label }}</span>
            <span class="block truncate text-muted">{{ item.description }}</span>
          </span>
          <span v-if="isCurrent(item)" class="text-[11px] text-accent">当前</span>
          <ArrowRight v-else class="h-4 w-4 text-surface-600" />
        </button>
        <EmptyState icon="Search" compact title="没有匹配的页面" description="尝试其他关键词" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch, onMounted, onUnmounted } from 'vue';
import { useEscapeKey } from '../composables/useEscapeKey.js';
import { useRoute, useRouter } from 'vue-router';
import { Activity, ArrowRight, Bot, Boxes, ChartNoAxesCombined, ChevronDown, FileCode2, FileSearch, BellRing, History, KeyRound, Layers, LogOut, Play, RotateCw, Rows3, ScrollText, Search, Settings, ShieldCheck, Square, Store, TerminalSquare, X } from 'lucide-vue-next';
import EventCenter from './EventCenter.vue';
import HostSwitcher from './HostSwitcher.vue';
import { api } from '../api/client.js';
import { useHostsStore } from '../stores/hosts.js';
import { useToastStore } from '../stores/toast.js';
import EmptyState from './common/EmptyState.vue';

const route = useRoute();
const router = useRouter();
const hostsStore = useHostsStore();
const toast = useToastStore();
const backendOnline = ref(false);
const currentTime = ref('');
const commandOpen = ref(false);
const commandQuery = ref('');
const selectedCommand = ref(0);
const commandInput = ref(null);
const projectSwitcherOpen = ref(false);
const density = ref(localStorage.getItem('composeops:density') || 'comfortable');
function toggleDensity() { density.value = density.value === 'compact' ? 'comfortable' : 'compact'; document.body.dataset.density = density.value; localStorage.setItem('composeops:density', density.value); }
/** 归一化 API 返回值,避免非数组形态触发 `.slice`/`.filter` 报错。 */
function asArray(value) { return Array.isArray(value) ? value : []; }
const allProjects = ref([]);
const quickProjects = computed(() => asArray(allProjects.value).slice(0, 12));
const pageNames = { services: '服务总览', compose: 'Compose 配置', logs: '实时日志', shell: '容器终端', agent: 'AI 智能运维 Agent', 'agent-history': 'Agent 执行历史', inspection: 'AI 巡检中心', monitor: '实时监控', review: '变更与回滚', events: '事件中心', resources: '存储清理', cron: '定时任务', gitops: 'GitOps', cost: '成本分析', marketplace: '应用市场', settings: '系统设置' };
const currentPage = computed(() => pageNames[route.name] || '运维控制台');
const envProjects = ref([]);
const appBlueprints = ref([]);
const baseCommands = [
  { to: '/services', label: '服务总览', description: '查看项目健康状态并执行生命周期操作', icon: Boxes, keywords: 'dashboard stack container 项目 容器' },
  { to: '/compose', label: 'Compose 配置', description: '编辑、校验和恢复 Compose 文件', icon: FileCode2, keywords: 'yaml editor backup 配置 备份' },
  { to: '/logs', label: '实时日志', description: '连接容器输出并搜索、暂停或导出', icon: ScrollText, keywords: 'stdout stderr search 日志' },
  { to: '/shell', label: '容器终端', description: '打开受限的交互式 Shell', icon: TerminalSquare, keywords: 'terminal bash sh 终端' },
  { to: '/agent', label: 'AI 智能运维 Agent', description: '挂载日志、检索资料并执行 Compose 运维操作', icon: Bot, keywords: 'agent ai chat workflow 编排 执行 工具 运维 诊断 诊断 chat' },
  { to: '/inspection', label: 'AI 巡检中心', description: '只读巡检容器、磁盘、内存与备份时效,输出结论与建议', icon: ShieldCheck, keywords: 'inspection scan health check 巡检 体检 检查 报告' },
  { to: '/monitor', label: '实时监控', description: '检查容器 CPU、内存用量的实时概览', icon: ChartNoAxesCombined, keywords: 'metrics cpu memory 监控 realtime 实时' },
  { to: '/monitor?tab=history', label: '历史指标', description: '回看容器资源指标的历史曲线与异常', icon: Activity, keywords: 'history chart metrics 指标 曲线 历史' },
  { to: '/events?tab=operations', label: '操作与任务', description: '审计 Compose、配置和维护操作,跟踪后台任务', icon: History, keywords: 'history audit 记录 审计 任务 job' },
  { to: '/events', label: '事件中心', description: '统一查看告警事件、运维时间线与操作任务', icon: BellRing, keywords: 'alert event timeline 事件 告警 时间线' },
  { to: '/review', label: '变更与回滚', description: '部署前 AI 评审变更,出问题后一键回滚', icon: FileSearch, keywords: 'review rollback change 变更 评审 回滚' },
  { to: '/settings', label: '系统设置', description: '配置通知、更新、AI 与项目纳管', icon: Settings, keywords: 'notification maintenance mounts 设置' },
  { to: '/settings?tab=mounts', label: '项目纳管', description: '选择允许控制和编辑 Compose 的项目', icon: Boxes, keywords: 'permission mount compose 权限 目录' },
  { to: '/settings?tab=notifications', label: '异常通知', description: '设置容器、内存和存储告警渠道', icon: Settings, keywords: 'alert webhook telegram email 告警' },
  { to: '/settings?tab=maintenance', label: 'Docker 维护', description: '检查镜像更新并清理可回收空间', icon: Settings, keywords: 'prune image update cleanup 清理 镜像' },
];
const commands = computed(() => {
  const nodeCommands = hostsStore.hosts
    .filter((host) => host.id !== hostsStore.activeHostId)
    .map((host) => ({
      id: `node-${host.id}`,
      run: () => void switchNode(host),
      label: `Switch Node: ${host.name}`,
      description: host.type === 'local' ? '切换到本机 Docker' : `切换到 ${host.type.toUpperCase()} ${host.host}:${host.port}`,
      icon: Layers,
      keywords: `switch node host docker 节点 切换 ${host.name}`,
    }));
  const envCommands = asArray(envProjects.value)
    .filter((project) => project.editable)
    .map((project) => ({
      to: `/services?env=${project.id}`,
      label: `Env: ${project.projectName}`,
      description: `编辑 ${project.projectName} 的环境变量 (.env)`,
      icon: KeyRound,
      keywords: `env environment variable 环境变量 ${project.projectName}`,
    }));
  const blueprintCommands = asArray(appBlueprints.value)
    .slice(0, 12)
    .map((blueprint) => ({
      to: '/marketplace',
      label: `应用市场: ${blueprint.name}`,
      description: `一键部署 ${blueprint.name} (${blueprint.category})`,
      icon: Store,
      keywords: `app store blueprint deploy marketplace 部署 应用市场 模板市场 ${blueprint.name}`,
    }));
  const actionCommands = asArray(allProjects.value)
    .filter((project) => project.managed)
    .slice(0, 8)
    .flatMap((project) => ([
      { id: `run-${project.id}-up`, run: () => void runProjectAction(project, 'up'), label: `启动: ${project.projectName}`, description: '通过 Compose 启动项目', icon: Play, keywords: `start up 启动 运行 ${project.projectName}` },
      { id: `run-${project.id}-restart`, run: () => void runProjectAction(project, 'restart'), label: `重启: ${project.projectName}`, description: '重启项目所有容器', icon: RotateCw, keywords: `restart reboot 重启 ${project.projectName}` },
      { id: `run-${project.id}-stop`, run: () => void runProjectAction(project, 'stop'), label: `停止: ${project.projectName}`, description: '停止项目所有容器', icon: Square, keywords: `stop halt 停止 ${project.projectName}` },
      { id: `logs-${project.id}`, to: `/logs?projectId=${project.id}`, label: `日志: ${project.projectName}`, description: '查看项目实时日志', icon: ScrollText, keywords: `logs 日志 ${project.projectName}` },
    ]));
  return [...actionCommands, ...nodeCommands, ...envCommands, ...blueprintCommands, ...baseCommands];
});
const filteredCommands = computed(() => {
  const query = commandQuery.value.trim().toLowerCase();
  return query ? commands.value.filter((item) => `${item.label} ${item.description} ${item.keywords}`.toLowerCase().includes(query)) : commands.value;
});

function goProject(project) {
  projectSwitcherOpen.value = false;
  router.push(`/services?focus=${project.id}`);
}
async function runProjectAction(project, action) {
  closeCommand();
  try {
    await api.createProjectBatchJob([project.id], action);
    window.dispatchEvent(new CustomEvent('composeops:operation-started', { detail: { projectName: project.projectName, action } }));
  } catch (error) {
    toast.error(`操作提交失败:${error?.message || '未知错误'}`);
  }
}
const emit = defineEmits(['logout', 'open-agent']);
function emitAgentOpen() {
  emit('open-agent');
}
let pingTimer; let clockTimer;

async function ping() {
  try {
    const res = await fetch('/health');
    backendOnline.value = res.ok;
  } catch {
    backendOnline.value = false;
  }
}
function closeCommand() { commandOpen.value = false; commandQuery.value = ''; }
function isCurrent(item) { return item.to.includes('?') ? route.fullPath === item.to : route.path === item.to; }
function runCommand(item) {
  if (item.run) { item.run(); closeCommand(); return; }
  router.push(item.to); closeCommand();
}
async function switchNode(host) {
  try {
    await hostsStore.switchHost(host.id);
    window.dispatchEvent(new CustomEvent('composeops:host-changed'));
  } catch (error) {
    toast.error(`切换到 ${host.name} 失败:${error?.message || '未知错误'}`);
  }
}
function runSelected() { const item = filteredCommands.value[selectedCommand.value]; if (item) runCommand(item); }
function moveSelection(delta) {
  const count = filteredCommands.value.length;
  if (count) selectedCommand.value = (selectedCommand.value + delta + count) % count;
}
function onGlobalKeydown(event) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); commandOpen.value = !commandOpen.value; }
}
watch(commandOpen, (open) => { if (open) nextTick(() => commandInput.value?.focus()); });
useEscapeKey({ active: commandOpen, onClose: closeCommand, layer: 'command' });
watch(filteredCommands, () => { selectedCommand.value = 0; });
onMounted(() => {
  if (!hostsStore.hosts.length) void hostsStore.load();
  void api.getProjects(true).then((data) => {
    const list = asArray(data?.projects);
    envProjects.value = list.filter((project) => project.editable);
    allProjects.value = list;
  }).catch(() => {});
  void api.getBlueprints().then((data) => { appBlueprints.value = asArray(data?.blueprints); }).catch(() => {});
  ping();
  currentTime.value = new Date().toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  pingTimer = setInterval(ping, 5000);
  clockTimer = setInterval(() => { currentTime.value = new Date().toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }, 30000);
  window.addEventListener('keydown', onGlobalKeydown);
});
onUnmounted(() => { clearInterval(pingTimer); clearInterval(clockTimer); window.removeEventListener('keydown', onGlobalKeydown); });
</script>
