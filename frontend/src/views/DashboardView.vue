<template>
  <div class="page-shell">
    <div class="page-header">
      <div>
        <h1 class="page-title">运维总览</h1>
        <p class="page-subtitle">系统健康、运营态势与 AI 决策建议</p>
      </div>
      <div class="page-actions">
        <span v-if="lastUpdated" class="text-xs text-muted">更新于 {{ lastUpdated }}</span>
        <button class="btn-secondary" :disabled="loading" @click="load">
          <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': loading }" />刷新
        </button>
      </div>
    </div>

    <div v-if="loadError" class="alert-error flex items-center justify-between gap-3">
      <span>{{ loadError }}</span>
      <button class="btn-secondary !px-2.5 !py-1 text-xs" :disabled="loading" @click="load">重试</button>
    </div>

    <Skeleton v-if="loading && !hasLoaded" variant="cards" :rows="4" label="总览数据加载中" />

    <EmptyState
      v-else-if="hasLoaded && !loadError && !projectCount"
      icon="Boxes"
      title="暂未发现 Compose 项目"
      description="Docker 中没有带 Compose 标签的项目,或尚未扫描,可前往服务总览查看"
    />

    <template v-else>
      <div class="metric-grid">
        <div class="metric-tile">
          <span class="metric-icon text-blue-300"><Boxes class="h-5 w-5" /></span>
          <span><strong>{{ projectCount }}</strong><small>项目总数</small></span>
          <span class="metric-meta">健康 {{ healthyProjects }}</span>
        </div>
        <div class="metric-tile">
          <span class="metric-icon text-emerald-300"><Container class="h-5 w-5" /></span>
          <span><strong>{{ containerCount }}</strong><small>容器总数</small></span>
          <span class="metric-meta">运行 {{ runningContainers }}</span>
        </div>
        <div class="metric-tile">
          <span class="metric-icon" :class="cpuTone"><Cpu class="h-5 w-5" /></span>
          <span><strong class="font-mono tabular-nums" :class="cpuTone">{{ cpu }}%</strong><small>CPU</small></span>
          <SparklineChart :cpu="monitorTrends.cpu" :mem="[]" :width="72" :height="20" />
          <span class="metric-meta">{{ cpuState }}</span>
        </div>
        <div class="metric-tile">
          <span class="metric-icon" :class="memoryTone"><MemoryStick class="h-5 w-5" /></span>
          <span><strong class="font-mono tabular-nums" :class="memoryTone">{{ memory }}%</strong><small>内存</small></span>
          <SparklineChart :cpu="[]" :mem="monitorTrends.mem" :width="72" :height="20" />
          <span class="metric-meta">{{ memoryState }}</span>
        </div>
        <div class="metric-tile">
          <span class="metric-icon" :class="inspectionTone"><Gauge class="h-5 w-5" /></span>
          <span><strong class="font-mono tabular-nums" :class="inspectionTone">{{ inspectionScore }}</strong><small>巡检评分</small></span>
          <span class="metric-meta">{{ inspectionSummary }}</span>
        </div>
      </div>

      <div class="grid gap-4 xl:grid-cols-3">
        <section class="section-panel">
          <h3 class="mb-4 font-semibold text-surface-100">运行态势</h3>
          <div class="space-y-3 text-sm text-surface-300">
            <div class="flex items-center justify-between gap-3"><span>CPU 使用率</span><span class="font-mono tabular-nums" :class="cpuTone">{{ cpu }}%</span></div>
            <div class="flex items-center justify-between gap-3"><span>内存使用率</span><span class="font-mono tabular-nums" :class="memoryTone">{{ memory }}%</span></div>
            <div class="flex items-center justify-between gap-3"><span>网络吞吐</span><span class="text-muted">{{ networkSummary }}</span></div>
            <div class="flex items-center justify-between gap-3"><span>Docker 存储</span><span class="text-muted">{{ dockerStorage }}</span></div>
            <div class="flex items-center justify-between gap-3">
              <span>系统状态</span>
              <StatusBadge :status="healthScore >= 90 ? 'running' : 'partial'" size="sm" />
            </div>
          </div>
        </section>

        <section class="section-panel">
          <h3 class="mb-4 font-semibold text-surface-100">今日运营</h3>
          <div class="space-y-3 text-sm text-surface-300">
            <div class="flex items-center justify-between gap-3"><span>最近操作</span><span class="truncate text-muted">{{ recentOperation }}</span></div>
            <div class="flex items-center justify-between gap-3"><span>任务成功率</span><span class="font-mono tabular-nums" :class="successRateTone">{{ successRate }}%</span></div>
            <div class="flex items-center justify-between gap-3"><span>GitOps 状态</span><span class="text-muted">{{ gitopsSummary }}</span></div>
            <div class="flex items-center justify-between gap-3"><span>运营记录数</span><span class="font-mono tabular-nums text-muted">{{ operations.length }}</span></div>
          </div>
        </section>

        <section class="section-panel">
          <div class="mb-4 flex items-center justify-between gap-3">
            <h3 class="font-semibold text-surface-100">AI 建议中心</h3>
            <StatusBadge :status="attentionProjects ? 'partial' : 'healthy'" size="sm" />
          </div>
          <div class="space-y-3 text-sm text-surface-300">
            <div class="flex items-center justify-between gap-3"><span>巡检评分</span><span class="font-mono tabular-nums" :class="inspectionTone">{{ inspectionScore }}</span></div>
            <p class="text-muted">{{ inspectionSummary }}</p>
            <p class="text-amber-300">{{ riskHint }}</p>
            <p class="text-emerald-300">{{ recommendation }}</p>
          </div>
        </section>
      </div>

      <div class="grid gap-4 xl:grid-cols-2">
        <section class="section-panel">
          <div class="mb-4 flex items-center justify-between">
            <h3 class="font-semibold text-surface-100">最近事件</h3>
            <router-link to="/events?tab=timeline" class="text-xs text-emerald-400 hover:text-emerald-300">查看全部 →</router-link>
          </div>
          <div v-if="recentEvents.length" class="space-y-2">
            <div v-for="event in recentEvents" :key="event.key" class="flex items-center gap-3 rounded-lg border border-surface-800 bg-surface-900/60 px-3 py-2">
              <span class="h-2 w-2 shrink-0 rounded-full" :class="dotClass(event.level)"></span>
              <span class="count-badge shrink-0 text-[10px]" :class="sourceBadgeClass(event.source)">{{ sourceLabel(event.source) }}</span>
              <span class="min-w-0 flex-1 truncate text-sm text-surface-200">{{ event.title }}</span>
              <span class="shrink-0 font-mono text-[11px] tabular-nums text-surface-500">{{ formatTime(event.timestamp) }}</span>
            </div>
          </div>
          <EmptyState v-else compact icon="History" title="暂无事件记录" />
        </section>

        <section class="section-panel">
          <h3 class="mb-4 font-semibold text-surface-100">快速入口</h3>
          <div class="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
            <router-link
              v-for="item in quickLinks"
              :key="item.to"
              :to="item.to"
              class="card px-4 py-4 text-center text-sm text-surface-200 transition hover:border-emerald-500/60 hover:text-emerald-300"
            >
              {{ item.label }}
            </router-link>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { Boxes, Container, Cpu, Gauge, MemoryStick, RefreshCw } from 'lucide-vue-next';
import { api } from '../api/client.js';
import { useServicesStore } from '../stores/services.js';
import EmptyState from '../components/common/EmptyState.vue';
import Skeleton from '../components/common/Skeleton.vue';
import StatusBadge from '../components/common/StatusBadge.vue';
import SparklineChart from '../components/common/SparklineChart.vue';
import { monitorTrends, pushMonitorTrend } from '../lib/monitor-trends.js';

const store = useServicesStore();
const metrics = ref(null);
const inspection = ref(null);
const operations = ref([]);
const recentEvents = ref([]);
const loading = ref(false);
const hasLoaded = ref(false);
const loadError = ref('');
const lastUpdated = ref('');

const quickLinks = [
  { label: '服务管理', to: '/services' },
  { label: '实时监控', to: '/monitor' },
  { label: 'AI巡检', to: '/inspection' },
  { label: 'GitOps', to: '/gitops' },
  { label: 'Agent', to: '/agent' },
  { label: '定时任务', to: '/cron' },
  { label: '成本分析', to: '/cost' },
];

const projectCount = computed(() => store.projects.length);
const containerCount = computed(() => store.projects.reduce((n, p) => n + (p.containers?.length || 0), 0));
const runningContainers = computed(() => store.projects.reduce((n, p) => n + (p.containers || []).filter(c => c.state === 'running').length, 0));
const attentionProjects = computed(() => store.projects.filter(p => p.status !== 'running' || (p.containers || []).some(c => c.health === 'unhealthy')).length);
const healthyProjects = computed(() => projectCount.value - attentionProjects.value);
const healthScore = computed(() => projectCount.value ? Math.round((healthyProjects.value / projectCount.value) * 100) : 100);

const cpu = computed(() => metrics.value?.host?.cpu?.percent ?? 0);
const memory = computed(() => metrics.value?.host?.memory?.percent ?? 0);
const cpuState = computed(() => cpu.value > 80 ? '负载较高' : '运行正常');
const memoryState = computed(() => memory.value > 80 ? '内存偏高' : '资源充足');
const cpuTone = computed(() => cpu.value > 80 ? 'text-amber-300' : 'text-emerald-300');
const memoryTone = computed(() => memory.value > 80 ? 'text-amber-300' : 'text-emerald-300');

const networkSummary = computed(() => `RX:${metrics.value?.network?.rx ?? 0} TX:${metrics.value?.network?.tx ?? 0}`);
const dockerStorage = computed(() => '已接入 Docker 存储统计');

const inspectionScore = computed(() => inspection.value?.latest?.score ?? '--');
const inspectionSummary = computed(() => inspection.value?.latest?.summary ?? '暂无巡检数据');
const inspectionTone = computed(() => {
  const score = inspection.value?.latest?.score;
  if (score == null) return 'text-surface-300';
  if (score >= 90) return 'text-emerald-300';
  if (score >= 70) return 'text-amber-300';
  return 'text-rose-300';
});

const recentOperation = computed(() => operations.value[0]?.action || '暂无记录');
const successRate = computed(() => operations.value.length ? Math.round((operations.value.filter(i => i.status === 'success').length / operations.value.length) * 100) : 100);
const successRateTone = computed(() => successRate.value >= 90 ? 'text-emerald-300' : successRate.value >= 70 ? 'text-amber-300' : 'text-rose-300');
const gitopsSummary = computed(() => `${projectCount.value} 个项目已纳管`);
const riskHint = computed(() => attentionProjects.value ? `发现 ${attentionProjects.value} 个需要关注的项目` : '暂无高风险项');
const recommendation = computed(() => attentionProjects.value ? '建议优先处理异常项目并执行 AI 巡检' : '建议执行容量预测与例行巡检');

const SOURCE_LABELS = { operation: '操作', agent: 'Agent', alert: '告警', cron: '定时', gitops: 'GitOps' };
function sourceLabel(s) { return SOURCE_LABELS[s] || s; }
function sourceBadgeClass(s) {
  return { operation: 'text-blue-300', agent: 'text-emerald-300', alert: 'text-rose-300', cron: 'text-amber-300', gitops: 'text-violet-300' }[s] || 'text-surface-400';
}
function dotClass(l) {
  return { success: 'bg-emerald-400', info: 'bg-sky-400', warning: 'bg-amber-400', error: 'bg-rose-400' }[l] || 'bg-surface-500';
}
function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}
function parseTs(value) {
  if (!value) return 0;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}
function pushEvent(list, event) {
  if (!event || !event.timestamp) return;
  list.push({ key: `${event.source}-${event.id}-${event.timestamp}`, ts: parseTs(event.timestamp), ...event });
}
function actionLabel(action) {
  const labels = { 'compose.save': '保存配置', 'compose.restore': '恢复配置', 'projects.management': '更新纳管范围', 'projects.mounts': '更新目录范围', 'docker.prune': '清理 Docker 空间', 'images.check': '检查镜像更新', 'settings.import': '导入设置', up: '启动项目', restart: '重启项目', stop: '停止项目', pull: '拉取镜像', ps: '检查状态' };
  return labels[action] || labels[String(action).split('.').pop()] || action;
}
async function loadRecentEvents(errors) {
  const list = [];
  const [operationData, agentData, alertData, cronData] = await Promise.allSettled([
    api.getOperations(),
    api.getAgentExecutions(),
    api.getAlertEvents(20),
    api.getCronHistory(20),
  ]);
  if (operationData.status === 'fulfilled') {
    for (const op of operationData.value.operations || []) {
      pushEvent(list, { source: 'operation', id: op.id, timestamp: op.createdAt, level: op.status === 'success' ? 'success' : 'error', title: actionLabel(op.action), detail: op.detail || '', projectName: op.projectName || '' });
    }
  } else errors.push(operationData.reason);
  if (agentData.status === 'fulfilled') {
    for (const plan of agentData.value.plans || []) {
      pushEvent(list, { source: 'agent', id: plan.id, timestamp: plan.created_at || plan.executed_at, level: plan.status === 'completed' ? 'success' : plan.status === 'failed' ? 'error' : 'info', title: plan.user_message || 'Agent 执行', detail: '', projectName: '' });
    }
  } else errors.push(agentData.reason);
  if (alertData.status === 'fulfilled') {
    for (const ev of alertData.value.events || []) {
      pushEvent(list, { source: 'alert', id: ev.id, timestamp: ev.created_at, level: ev.priority === 'danger' ? 'error' : 'warning', title: ev.title, detail: ev.detail || '', projectName: ev.target || '' });
    }
  } else errors.push(alertData.reason);
  if (cronData.status === 'fulfilled') {
    for (const item of cronData.value.history || []) {
      pushEvent(list, { source: 'cron', id: item.id, timestamp: item.at, level: item.status === 'success' ? 'success' : 'error', title: `定时任务:${item.jobName || ''}`, detail: item.error || '', projectName: '' });
    }
  } else errors.push(cronData.reason);
  recentEvents.value = list.sort((a, b) => b.ts - a.ts).slice(0, 6);
}

async function load() {
  if (loading.value) return;
  loading.value = true;
  const errors = [];
  try {
    await store.refresh(false);
    if (store.error) errors.push(new Error(store.error));
    const [metricsRes, inspectionRes, operationsRes] = await Promise.allSettled([
      api.getMetrics(),
      api.getInspectionOverview(1),
      api.getOperations(),
    ]);
    if (metricsRes.status === 'fulfilled') {
      metrics.value = metricsRes.value;
      const host = metricsRes.value?.host;
      const rx = metricsRes.value?.network?.rx || 0;
      if (host) pushMonitorTrend({ cpu: host.cpu?.percent, mem: host.memory?.percent, net: Math.max(1, Math.round((rx / 1024 / 1024) * 100) / 100) });
    } else errors.push(metricsRes.reason);
    if (inspectionRes.status === 'fulfilled') inspection.value = inspectionRes.value; else errors.push(inspectionRes.reason);
    if (operationsRes.status === 'fulfilled') operations.value = operationsRes.value.operations || []; else errors.push(operationsRes.reason);
    await loadRecentEvents(errors);
    loadError.value = errors.length ? `部分数据加载失败:${errors[0]?.message || '未知错误'}` : '';
    if (!errors.length) {
      lastUpdated.value = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    }
  } catch (error) {
    loadError.value = `总览数据加载失败:${error?.message || '未知错误'}`;
  } finally {
    loading.value = false;
    hasLoaded.value = true;
  }
}

onMounted(load);
</script>
