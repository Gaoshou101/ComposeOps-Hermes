<template>
  <header class="app-header z-[45] h-16 flex items-center justify-between px-4 sm:px-6 shrink-0">
    <div class="flex min-w-0 items-center gap-3">
      <div class="brand-mark"><Boxes class="w-5 h-5" /></div>
      <div class="min-w-0">
        <span class="text-sm sm:text-base font-semibold tracking-tight">ComposeOps</span>
        <p class="text-muted truncate">{{ currentPage }}</p>
      </div>
    </div>
    <div class="flex items-center gap-2 sm:gap-3 text-sm">
      <button class="command-trigger" title="快速跳转" aria-label="打开快速跳转" @click="commandOpen = true">
        <Search class="h-4 w-4" />
        <span class="hidden md:inline">快速跳转</span>
      </button>
      <span v-if="backendOnline" class="status-pill text-emerald-300">
        <span class="status-ping bg-emerald-400"></span><span class="hidden sm:inline">服务正常</span>
      </span>
      <span v-else class="status-pill text-rose-300">
        <span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span><span class="hidden sm:inline">服务离线</span>
      </span>
      <HostSwitcher />
      <EventCenter />
      <span class="hidden lg:inline text-muted">{{ currentTime }}</span>
      <span class="h-5 w-px bg-surface-800"></span>
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
import { ArrowRight, Bot, Boxes, ChartNoAxesCombined, FileCode2, History, KeyRound, Layers, LogOut, ScrollText, Search, Settings, Store, TerminalSquare, X } from 'lucide-vue-next';
import EventCenter from './EventCenter.vue';
import HostSwitcher from './HostSwitcher.vue';
import { api } from '../api/client.js';
import { useHostsStore } from '../stores/hosts.js';
import EmptyState from './common/EmptyState.vue';

const route = useRoute();
const router = useRouter();
const hostsStore = useHostsStore();
const backendOnline = ref(false);
const currentTime = ref('');
const commandOpen = ref(false);
const commandQuery = ref('');
const selectedCommand = ref(0);
const commandInput = ref(null);
const pageNames = { services: '服务总览', compose: 'Compose 配置', logs: '实时日志', shell: '容器终端', ai: 'AI 运维助手', monitor: '资源监控', operations: '操作记录', settings: '系统设置' };
const currentPage = computed(() => pageNames[route.name] || '运维控制台');
const envProjects = ref([]);
const appBlueprints = ref([]);
const baseCommands = [
  { to: '/services', label: '服务总览', description: '查看项目健康状态并执行生命周期操作', icon: Boxes, keywords: 'dashboard stack container 项目 容器' },
  { to: '/compose', label: 'Compose 配置', description: '编辑、校验和恢复 Compose 文件', icon: FileCode2, keywords: 'yaml editor backup 配置 备份' },
  { to: '/logs', label: '实时日志', description: '连接容器输出并搜索、暂停或导出', icon: ScrollText, keywords: 'stdout stderr search 日志' },
  { to: '/shell', label: '容器终端', description: '打开受限的交互式 Shell', icon: TerminalSquare, keywords: 'terminal bash sh 终端' },
  { to: '/ai', label: 'AI 运维助手', description: '结合配置和日志进行故障诊断', icon: Bot, keywords: 'diagnose chat 诊断' },
  { to: '/monitor', label: '资源监控', description: '检查 CPU、内存、网络和存储用量', icon: ChartNoAxesCombined, keywords: 'metrics cpu memory 监控' },
  { to: '/operations', label: '操作记录', description: '审计 Compose、配置和维护操作', icon: History, keywords: 'history audit 记录 审计' },
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
  const envCommands = envProjects.value
    .filter((project) => project.editable)
    .map((project) => ({
      to: `/services?env=${project.id}`,
      label: `Env: ${project.projectName}`,
      description: `编辑 ${project.projectName} 的环境变量 (.env)`,
      icon: KeyRound,
      keywords: `env environment variable 环境变量 ${project.projectName}`,
    }));
  const blueprintCommands = appBlueprints.value
    .slice(0, 12)
    .map((blueprint) => ({
      to: '/blueprints',
      label: `App Store: ${blueprint.name}`,
      description: `一键部署 ${blueprint.name} (${blueprint.category})`,
      icon: Store,
      keywords: `app store blueprint deploy 部署 应用市场 ${blueprint.name}`,
    }));
  return [...nodeCommands, ...envCommands, ...blueprintCommands, ...baseCommands];
});
const filteredCommands = computed(() => {
  const query = commandQuery.value.trim().toLowerCase();
  return query ? commands.value.filter((item) => `${item.label} ${item.description} ${item.keywords}`.toLowerCase().includes(query)) : commands.value;
});
defineEmits(['logout']);
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
  } catch {}
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
  void api.getProjects().then((data) => { envProjects.value = data.projects || []; }).catch(() => {});
  void api.getBlueprints().then((data) => { appBlueprints.value = data.blueprints || []; }).catch(() => {});
  ping();
  currentTime.value = new Date().toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  pingTimer = setInterval(ping, 5000);
  clockTimer = setInterval(() => { currentTime.value = new Date().toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }, 30000);
  window.addEventListener('keydown', onGlobalKeydown);
});
onUnmounted(() => { clearInterval(pingTimer); clearInterval(clockTimer); window.removeEventListener('keydown', onGlobalKeydown); });
</script>
