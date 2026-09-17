<template>
  <div class="page-shell">
    <div class="page-header">
      <div>
        <h1 class="page-title">服务拓扑中心</h1>
        <p class="page-subtitle">自动生成 Compose 服务依赖关系图,可视化 depends_on、端口与卷</p>
      </div>
      <div class="page-actions">
        <select v-model="selectedProjectId" class="input sm:w-56" aria-label="选择项目" @change="loadProject">
          <option value="">选择项目</option>
          <option v-for="p in store.projects" :key="p.id" :value="p.id">{{ p.projectName }}</option>
        </select>
        <button class="btn-secondary" :disabled="loading" @click="loadProject"><RefreshCw class="w-4 h-4" :class="{ 'animate-spin': loading }" />刷新</button>
      </div>
    </div>

    <p v-if="error" class="alert-error">{{ error }}</p>

    <EmptyState v-if="!selectedProjectId" icon="Network" title="选择项目查看拓扑" description="从上方下拉框选择一个 Compose 项目,自动生成服务依赖关系图" class="flex-1" />

    <template v-else>
      <!-- 项目概览 -->
      <div class="metric-grid">
        <div class="metric-tile"><span class="metric-icon text-blue-300"><Boxes class="h-5 w-5" /></span><span><strong>{{ services.length }}</strong><small>服务节点</small></span><span class="metric-meta">{{ project?.projectName }}</span></div>
        <div class="metric-tile"><span class="metric-icon text-emerald-300"><GitBranch class="h-5 w-5" /></span><span><strong>{{ edgeCount }}</strong><small>依赖关系</small></span><span class="metric-meta">depends_on</span></div>
        <div class="metric-tile"><span class="metric-icon text-violet-300"><Network class="h-5 w-5" /></span><span><strong>{{ networkCount }}</strong><small>网络</small></span><span class="metric-meta">共享网络</span></div>
        <div class="metric-tile"><span class="metric-icon text-amber-300"><HardDrive class="h-5 w-5" /></span><span><strong>{{ volumeCount }}</strong><small>数据卷</small></span><span class="metric-meta">持久化存储</span></div>
        <div class="metric-tile"><span class="metric-icon text-rose-300"><Container class="h-5 w-5" /></span><span><strong>{{ runningContainers }} / {{ containerCount }}</strong><small>运行容器</small></span><span class="metric-meta">实时状态</span></div>
      </div>

      <!-- 拓扑图 -->
      <section class="section-panel flex-1">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="section-title">依赖关系图</h2>
            <p class="mt-1 text-muted">节点为服务,连线为 depends_on 依赖;颜色表示容器运行状态</p>
          </div>
          <div class="flex flex-wrap items-center gap-3 text-xs text-surface-400">
            <span class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-full bg-emerald-400"></span>运行中</span>
            <span class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-full bg-rose-400"></span>已停止</span>
            <span class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-full bg-amber-400"></span>不健康</span>
            <span class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-full bg-surface-500"></span>无容器</span>
          </div>
        </div>

        <Skeleton v-if="loading" variant="table" :rows="4" label="拓扑加载中" />
        <EmptyState v-else-if="!services.length" icon="Network" title="该项目没有可解析的服务" description="项目可能没有 Compose 配置,或配置中未定义 services" />
        <div v-else class="overflow-auto rounded-2xl border border-surface-800 bg-surface-950/60">
          <svg :viewBox="`0 0 ${svgWidth} ${svgHeight}`" class="min-w-[720px] w-full" role="img" aria-label="服务拓扑图">
            <defs>
              <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="#475569" />
              </marker>
            </defs>
            <!-- 连线 -->
            <g v-for="edge in edges" :key="edge.key">
              <path :d="edgePath(edge)" fill="none" stroke="#334155" stroke-width="1.5" marker-end="url(#arrowhead)" />
            </g>
            <!-- 节点 -->
            <g v-for="node in nodes" :key="node.name" :transform="`translate(${node.x}, ${node.y})`">
              <rect :x="-nodeW/2" :y="-nodeH/2" :width="nodeW" :height="nodeH" rx="12" :fill="nodeFill(node)" :stroke="nodeStroke(node)" stroke-width="1.5" />
              <text :x="0" :y="-4" text-anchor="middle" class="topo-node-name" fill="#E2E8F0">{{ node.name }}</text>
              <text :x="0" :y="14" text-anchor="middle" class="topo-node-sub" :fill="nodeSubColor(node)">{{ nodeSub(node) }}</text>
            </g>
          </svg>
        </div>
      </section>

      <!-- 服务明细 -->
      <section class="section-panel">
        <div class="mb-4"><h2 class="section-title">服务明细</h2><p class="mt-1 text-muted">每个服务的依赖、端口、卷与运行状态</p></div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>服务</th><th>状态</th><th>依赖</th><th>端口</th><th>卷</th><th>镜像</th></tr></thead>
            <tbody>
              <tr v-for="svc in services" :key="svc.name" class="hover:bg-surface-800/25">
                <td class="font-mono font-medium text-surface-100">{{ svc.name }}</td>
                <td><span class="status-badge" :class="svcStateClass(svc)">{{ svcStateLabel(svc) }}</span></td>
                <td class="text-surface-300">{{ svc.dependsOn.length ? svc.dependsOn.join(', ') : '—' }}</td>
                <td class="font-mono text-xs text-emerald-300">{{ svc.ports.length ? svc.ports.join(', ') : '—' }}</td>
                <td class="font-mono text-xs text-amber-300">{{ svc.volumes.length ? svc.volumes.length + ' 个' : '—' }}</td>
                <td class="max-w-56 truncate text-muted" :title="svc.image">{{ svc.image || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { Boxes, Container, GitBranch, HardDrive, Network, RefreshCw } from 'lucide-vue-next';
import * as YAML from 'yaml';
import { api } from '../api/client.js';
import { useServicesStore } from '../stores/services.js';
import Skeleton from '../components/common/Skeleton.vue';
import EmptyState from '../components/common/EmptyState.vue';

const store = useServicesStore();
const selectedProjectId = ref('');
const loading = ref(false);
const error = ref('');
const services = ref([]);
const networks = ref([]);
const volumes = ref([]);

const nodeW = 150;
const nodeH = 52;
const levelGap = 220;
const nodeGap = 90;

const project = computed(() => store.projects.find((p) => p.id === selectedProjectId.value));
const containerCount = computed(() => project.value?.containers?.length || 0);
const runningContainers = computed(() => (project.value?.containers || []).filter((c) => c.state === 'running').length);
const networkCount = computed(() => networks.value.length);
const volumeCount = computed(() => volumes.value.length);
const edgeCount = computed(() => services.value.reduce((n, s) => n + s.dependsOn.length, 0));

// 计算分层布局
const nodes = computed(() => {
  const levels = computeLevels(services.value);
  const result = [];
  for (const item of levels) {
    const x = 80 + item.level * levelGap;
    const y = 60 + (item.count > 1 ? (item.index - (item.count - 1) / 2) * nodeGap : 0);
    result.push({ name: item.name, x, y, level: item.level });
  }
  return result;
});
const edges = computed(() => {
  const list = [];
  for (const svc of services.value) {
    for (const dep of svc.dependsOn) {
      list.push({ key: `${dep}->${svc.name}`, from: dep, to: svc.name });
    }
  }
  return list;
});
const svgWidth = computed(() => {
  const maxLevel = Math.max(0, ...nodes.value.map((n) => n.level));
  return 160 + maxLevel * levelGap + nodeW;
});
const svgHeight = computed(() => {
  const maxCount = Math.max(1, ...groupByLevel(nodes.value).map((g) => g.length));
  return 120 + maxCount * nodeGap;
});

function groupByLevel(nodeList) {
  const map = new Map();
  for (const n of nodeList) {
    if (!map.has(n.level)) map.set(n.level, []);
    map.get(n.level).push(n);
  }
  return [...map.values()];
}
function computeLevels(serviceList) {
  const levelMap = new Map();
  const visit = (name, visiting) => {
    if (levelMap.has(name)) return levelMap.get(name);
    if (visiting.has(name)) return 0;
    visiting.add(name);
    const svc = serviceList.find((s) => s.name === name);
    let level = 0;
    if (svc) {
      for (const dep of svc.dependsOn) {
        level = Math.max(level, visit(dep, visiting) + 1);
      }
    }
    visiting.delete(name);
    levelMap.set(name, level);
    return level;
  };
  for (const svc of serviceList) visit(svc.name, new Set());
  const byLevel = new Map();
  for (const [name, level] of levelMap) {
    if (!byLevel.has(level)) byLevel.set(level, []);
    byLevel.get(level).push(name);
  }
  const result = [];
  for (const [level, names] of byLevel) {
    names.forEach((name, index) => result.push({ name, level, index, count: names.length }));
  }
  return result;
}
function nodePos(name) {
  return nodes.value.find((n) => n.name === name);
}
function edgePath(edge) {
  const from = nodePos(edge.from);
  const to = nodePos(edge.to);
  if (!from || !to) return '';
  const x1 = from.x + nodeW / 2;
  const y1 = from.y;
  const x2 = to.x - nodeW / 2;
  const y2 = to.y;
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

function svcState(svc) {
  const container = (project.value?.containers || []).find((c) => c.name.includes(svc.name));
  if (!container) return 'none';
  if (container.health === 'unhealthy') return 'unhealthy';
  return container.state === 'running' ? 'running' : 'stopped';
}
function nodeFill(node) {
  const s = svcState(node);
  return { running: '#052E16', unhealthy: '#451A03', stopped: '#1E293B', none: '#0F172A' }[s] || '#0F172A';
}
function nodeStroke(node) {
  const s = svcState(node);
  return { running: '#10B981', unhealthy: '#F59E0B', stopped: '#F43F5E', none: '#334155' }[s] || '#334155';
}
function nodeSubColor(node) {
  const s = svcState(node);
  return { running: '#6EE7B7', unhealthy: '#FCD34D', stopped: '#FDA4AF', none: '#64748B' }[s] || '#64748B';
}
function nodeSub(node) {
  const s = svcState(node);
  return { running: '运行中', unhealthy: '不健康', stopped: '已停止', none: '无容器' }[s] || '无容器';
}
function svcStateClass(svc) {
  const s = svcState(svc);
  return { running: 'bg-emerald-500/10 text-emerald-400', unhealthy: 'bg-amber-500/10 text-amber-400', stopped: 'bg-rose-500/10 text-rose-400', none: 'bg-surface-800 text-surface-400' }[s] || 'bg-surface-800 text-surface-400';
}
function svcStateLabel(svc) {
  const s = svcState(svc);
  return { running: '运行中', unhealthy: '不健康', stopped: '已停止', none: '无容器' }[s] || '无容器';
}

async function loadProject() {
  if (!selectedProjectId.value) return;
  loading.value = true;
  error.value = '';
  services.value = [];
  networks.value = [];
  volumes.value = [];
  try {
    const data = await api.getComposeFile(selectedProjectId.value, 0);
    const parsed = YAML.parse(data.content || '');
    const svcMap = parsed?.services || {};
    services.value = Object.entries(svcMap).map(([name, cfg]) => ({
      name,
      image: cfg.image || '',
      dependsOn: Array.isArray(cfg.depends_on) ? cfg.depends_on : cfg.depends_on ? Object.keys(cfg.depends_on) : [],
      ports: (cfg.ports || []).map((p) => String(p)),
      volumes: (cfg.volumes || []).map((v) => String(v)),
    }));
    networks.value = Object.keys(parsed?.networks || {});
    volumes.value = Object.keys(parsed?.volumes || {});
  } catch (e) {
    error.value = `拓扑解析失败: ${e.message}`;
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await store.refresh(false);
});
</script>

<style scoped>
.topo-node-name { font-size: 13px; font-weight: 600; font-family: ui-monospace, monospace; }
.topo-node-sub { font-size: 11px; }
</style>