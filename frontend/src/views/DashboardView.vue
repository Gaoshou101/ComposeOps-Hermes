<template>
  <div class="page-shell space-y-5">
    <section class="rounded-3xl border border-emerald-900/40 bg-gradient-to-r from-slate-950 via-slate-900 to-emerald-950/40 p-6">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 class="text-3xl font-bold text-slate-100">运维总览</h1>
          <p class="mt-2 text-slate-400">系统健康、运营态势与 AI 决策建议</p>
        </div>
        <div class="flex gap-3">
          <div class="rounded-2xl border border-slate-800 px-4 py-3">
            <div class="text-xs text-slate-500">健康分数</div>
            <div class="text-2xl font-bold text-emerald-400">{{ healthScore }}</div>
          </div>
          <div class="rounded-2xl border border-slate-800 px-4 py-3">
            <div class="text-xs text-slate-500">异常项目</div>
            <div class="text-2xl font-bold text-amber-400">{{ attentionProjects }}</div>
          </div>
          <div class="rounded-2xl border border-slate-800 px-4 py-3">
            <div class="text-xs text-slate-500">巡检评分</div>
            <div class="text-2xl font-bold text-sky-400">{{ inspectionScore }}</div>
          </div>
        </div>
      </div>
    </section>

    <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
      <StatCard title="项目总数" :value="String(projectCount)" :sub="`健康 ${healthyProjects}`" />
      <StatCard title="容器总数" :value="String(containerCount)" :sub="`运行 ${runningContainers}`" />
      <StatCard title="CPU" :value="`${cpu}%`" :sub="cpuState" />
      <StatCard title="内存" :value="`${memory}%`" :sub="memoryState" />
      <StatCard title="巡检评分" :value="String(inspectionScore)" :sub="inspectionSummary" />
    </div>

    <div class="grid gap-4 xl:grid-cols-3">
      <section class="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
        <h3 class="mb-4 font-semibold text-slate-100">运行态势</h3>
        <div class="space-y-3 text-sm text-slate-300">
          <div>CPU 使用率：{{ cpu }}%</div>
          <div>内存使用率：{{ memory }}%</div>
          <div>网络吞吐：{{ networkSummary }}</div>
          <div>Docker 存储：{{ dockerStorage }}</div>
          <div>系统状态：{{ healthScore >= 90 ? '稳定' : '需关注' }}</div>
        </div>
      </section>

      <section class="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
        <h3 class="mb-4 font-semibold text-slate-100">今日运营</h3>
        <div class="space-y-3 text-sm text-slate-300">
          <div>最近操作：{{ recentOperation }}</div>
          <div>任务成功率：{{ successRate }}%</div>
          <div>GitOps 状态：{{ gitopsSummary }}</div>
          <div>运营记录数：{{ operations.length }}</div>
        </div>
      </section>

      <section class="rounded-2xl border border-emerald-900/40 bg-emerald-950/10 p-5">
        <h3 class="mb-4 font-semibold text-emerald-300">AI 建议中心</h3>
        <div class="space-y-3 text-sm">
          <div>巡检评分：{{ inspectionScore }}</div>
          <div>{{ inspectionSummary }}</div>
          <div class="text-amber-300">{{ riskHint }}</div>
          <div class="text-emerald-300">{{ recommendation }}</div>
        </div>
      </section>
    </div>

<div class="grid gap-4 xl:grid-cols-2">
      <section class="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
        <div class="mb-4 flex items-center justify-between">
          <h3 class="font-semibold text-slate-100">最近事件</h3>
          <router-link to="/events?tab=timeline" class="text-xs text-emerald-400 hover:text-emerald-300">查看全部 →</router-link>
        </div>
        <div v-if="recentEvents.length" class="space-y-2">
          <div v-for="event in recentEvents" :key="event.key" class="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
            <span class="h-2 w-2 shrink-0 rounded-full" :class="dotClass(event.level)"></span>
            <span class="count-badge shrink-0 text-[10px]" :class="sourceBadgeClass(event.source)">{{ sourceLabel(event.source) }}</span>
            <span class="min-w-0 flex-1 truncate text-sm text-slate-200">{{ event.title }}</span>
            <span class="shrink-0 font-mono text-[11px] tabular-nums text-slate-500">{{ formatTime(event.timestamp) }}</span>
          </div>
        </div>
        <p v-else class="text-sm text-slate-500">暂无事件记录</p>
      </section>

      <section class="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
        <h3 class="mb-4 font-semibold text-slate-100">快速入口</h3>
        <div class="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
          <router-link
            v-for="item in quickLinks"
            :key="item.to"
            :to="item.to"
            class="rounded-xl border border-slate-800 bg-slate-900 px-4 py-4 text-center text-slate-200 transition hover:border-emerald-500"
          >
            {{ item.label }}
          </router-link>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api/client.js';
import { useServicesStore } from '../stores/services.js';
import StatCard from '../components/StatCard.vue';

const store = useServicesStore();
const metrics = ref(null);
const inspection = ref(null);
const operations = ref([]);
const recentEvents = ref([]);

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

const networkSummary = computed(() => `RX:${metrics.value?.network?.rx ?? 0} TX:${metrics.value?.network?.tx ?? 0}`);
const dockerStorage = computed(() => '已接入 Docker 存储统计');

const inspectionScore = computed(() => inspection.value?.latest?.score ?? '--');
const inspectionSummary = computed(() => inspection.value?.latest?.summary ?? '暂无巡检数据');

const recentOperation = computed(() => operations.value[0]?.action || '暂无记录');
const successRate = computed(() => operations.value.length ? Math.round((operations.value.filter(i => i.status === 'success').length / operations.value.length) * 100) : 100);
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
async function loadRecentEvents() {
  const list = [];
  try {
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
    }
    if (agentData.status === 'fulfilled') {
      for (const plan of agentData.value.plans || []) {
        pushEvent(list, { source: 'agent', id: plan.id, timestamp: plan.created_at || plan.executed_at, level: plan.status === 'completed' ? 'success' : plan.status === 'failed' ? 'error' : 'info', title: plan.user_message || 'Agent 执行', detail: '', projectName: '' });
      }
    }
    if (alertData.status === 'fulfilled') {
      for (const ev of alertData.value.events || []) {
        pushEvent(list, { source: 'alert', id: ev.id, timestamp: ev.created_at, level: ev.priority === 'danger' ? 'error' : 'warning', title: ev.title, detail: ev.detail || '', projectName: ev.target || '' });
      }
    }
    if (cronData.status === 'fulfilled') {
      for (const item of cronData.value.history || []) {
        pushEvent(list, { source: 'cron', id: item.id, timestamp: item.at, level: item.status === 'success' ? 'success' : 'error', title: `定时任务:${item.jobName || ''}`, detail: item.error || '', projectName: '' });
      }
    }
    recentEvents.value = list.sort((a, b) => b.ts - a.ts).slice(0, 6);
  } catch {}
}

onMounted(async () => {
  await store.refresh(false);
  try { metrics.value = await api.getMetrics(); } catch {}
  try { inspection.value = await api.getInspectionOverview(1); } catch {}
  try {
    const data = await api.getOperations();
    operations.value = data.operations || [];
  } catch {}
  void loadRecentEvents();
});
</script>