<template>
  <div class="resource-monitor-view">
    <!-- Header -->
    <div class="mb-4 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-zinc-100">资源监控</h1>
        <p class="mt-1 text-sm text-zinc-400">实时容器资源使用情况与告警配置</p>
      </div>
      <button @click="showAlertModal = true" class="btn-primary">
        <Bell class="h-4 w-4" />
        配置告警
      </button>
    </div>

    <!-- Container Selector -->
    <div class="mb-4 grid grid-cols-2 gap-3">
      <div>
        <label class="mb-1 block text-sm font-medium text-zinc-300">项目</label>
        <select v-model="projectId" @change="onProjectChange" class="input">
          <option value="">选择项目</option>
          <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.projectName }}</option>
        </select>
      </div>
      <div>
        <label class="mb-1 block text-sm font-medium text-zinc-300">容器</label>
        <select v-model="containerId" @change="loadMetrics" :disabled="!projectId" class="input">
          <option value="">选择容器</option>
          <option v-for="c in containers" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </div>
    </div>

    <!-- Metrics Dashboard -->
    <div v-if="containerId && metricsData" class="space-y-4">
      <!-- Metric Cards -->
      <div class="grid grid-cols-4 gap-3">
        <div v-for="m in metricTypes" :key="m.key" 
             @click="selectedMetric = m.key"
             :class="['metric-card', selectedMetric === m.key && 'metric-card-active']">
          <component :is="m.icon" :class="['h-5 w-5', m.color]" />
          <div class="mt-2">
            <div class="text-xs text-zinc-400">{{ m.label }}</div>
            <div class="mt-1 text-lg font-semibold text-zinc-100">
              {{ formatMetricValue(metricsData[m.key]) }}
            </div>
            <div class="mt-1 flex items-center gap-1 text-xs">
              <TrendingUp v-if="metricsData[m.key]?.trend === 'increasing'" class="h-3 w-3 text-rose-400" />
              <TrendingDown v-else-if="metricsData[m.key]?.trend === 'decreasing'" class="h-3 w-3 text-emerald-400" />
              <Minus v-else class="h-3 w-3 text-zinc-500" />
              <span :class="trendColor(metricsData[m.key]?.trend)">
                {{ metricsData[m.key]?.trend === 'stable' ? '稳定' : metricsData[m.key]?.trend === 'increasing' ? '上升' : '下降' }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Chart -->
      <div class="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="font-semibold text-zinc-100">{{ metricTypes.find(m => m.key === selectedMetric)?.label }}趋势</h2>
          <div class="flex gap-2">
            <button v-for="p in periods" :key="p.key"
                    @click="period = p.key; loadMetrics()"
                    :class="['px-3 py-1 text-xs rounded-md transition-colors', 
                             period === p.key ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700']">
              {{ p.label }}
            </button>
          </div>
        </div>
        <div class="chart-container">
          <svg :viewBox="`0 0 ${chartWidth} ${chartHeight}`" class="w-full">
            <!-- Grid lines -->
            <g v-for="i in 5" :key="`grid-${i}`">
              <line :x1="chartPadding" :y1="chartPadding + (chartHeight - 2 * chartPadding) * i / 5"
                    :x2="chartWidth - chartPadding" :y2="chartPadding + (chartHeight - 2 * chartPadding) * i / 5"
                    stroke="#27272a" stroke-width="1" />
            </g>
            <!-- Chart path -->
            <path v-if="chartPath" :d="chartPath" fill="none" stroke="url(#chart-gradient)" stroke-width="2" />
            <!-- Gradient -->
            <defs>
              <linearGradient id="chart-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#10b981" />
                <stop offset="100%" stop-color="#06b6d4" />
              </linearGradient>
            </defs>
          </svg>
        </div>
      </div>

      <!-- Alerts -->
      <div class="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="font-semibold text-zinc-100">告警规则</h2>
          <button @click="loadAlerts" class="text-xs text-zinc-400 hover:text-zinc-300">
            <RefreshCw class="h-3 w-3" />
          </button>
        </div>
        <div v-if="alerts.length === 0" class="py-6 text-center text-sm text-zinc-500">
          暂无告警规则
        </div>
        <div v-else class="space-y-2">
          <div v-for="alert in containerAlerts" :key="alert.id" 
               class="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
            <div class="flex items-center gap-3">
              <AlertTriangle :class="['h-4 w-4', getAlertColor(alert.metric)]" />
              <div>
                <div class="text-sm font-medium text-zinc-200">{{ metricTypes.find(m => m.key === alert.metric)?.label }}</div>
                <div class="mt-0.5 text-xs text-zinc-400">阈值: {{ alert.threshold }}{{ alert.metric === 'cpu' || alert.metric === 'memory' ? '%' : 'B' }}</div>
              </div>
            </div>
            <button @click="deleteAlertRule(alert.id)" class="text-xs text-rose-400 hover:text-rose-300">
              删除
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="!containerId" class="py-12 text-center text-zinc-500">
      <Activity class="mx-auto h-12 w-12 opacity-50" />
      <p class="mt-3">请选择项目和容器查看监控数据</p>
    </div>

    <!-- Alert Config Modal -->
    <div v-if="showAlertModal" class="modal-overlay" @click.self="showAlertModal = false">
      <div class="modal-content">
        <div class="mb-4 flex items-center justify-between">
          <h3 class="text-lg font-semibold text-zinc-100">配置告警规则</h3>
          <button @click="showAlertModal = false" class="text-zinc-400 hover:text-zinc-300">
            <X class="h-5 w-5" />
          </button>
        </div>
        <div class="space-y-3">
          <div>
            <label class="mb-1 block text-sm text-zinc-300">指标类型</label>
            <select v-model="alertForm.metric" class="input">
              <option v-for="m in metricTypes" :key="m.key" :value="m.key">{{ m.label }}</option>
            </select>
          </div>
          <div>
            <label class="mb-1 block text-sm text-zinc-300">阈值</label>
            <input v-model.number="alertForm.threshold" type="number" class="input" placeholder="例如: 80" />
          </div>
          <div>
            <label class="mb-1 block text-sm text-zinc-300">持续时间</label>
            <select v-model="alertForm.duration" class="input">
              <option value="1m">1 分钟</option>
              <option value="5m">5 分钟</option>
              <option value="10m">10 分钟</option>
            </select>
          </div>
          <div>
            <label class="mb-1 block text-sm text-zinc-300">动作</label>
            <select v-model="alertForm.action" class="input">
              <option value="notify">通知</option>
              <option value="restart">重启容器</option>
            </select>
          </div>
        </div>
        <div class="mt-4 flex gap-2">
          <button @click="createAlertRule" :disabled="!alertForm.metric || !alertForm.threshold" class="btn-primary flex-1">
            创建规则
          </button>
          <button @click="showAlertModal = false" class="btn-secondary flex-1">
            取消
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { Activity, AlertTriangle, Bell, Cpu, Database, HardDrive, Minus, Network, RefreshCw, TrendingDown, TrendingUp, X } from 'lucide-vue-next';
import { api, metricsApi } from '../api/client.js';

const projects = ref([]);
const projectId = ref('');
const containerId = ref('');
const selectedMetric = ref('cpu');
const period = ref('5m');
const metricsData = ref(null);
const alerts = ref([]);
const showAlertModal = ref(false);
const loading = ref(false);

const alertForm = ref({
  metric: 'cpu',
  threshold: 80,
  duration: '5m',
  action: 'notify'
});

const metricTypes = [
  { key: 'cpu', label: 'CPU', icon: Cpu, color: 'text-cyan-400' },
  { key: 'memory', label: '内存', icon: Database, color: 'text-emerald-400' },
  { key: 'network', label: '网络', icon: Network, color: 'text-amber-400' },
  { key: 'disk', label: '磁盘 I/O', icon: HardDrive, color: 'text-rose-400' }
];

const periods = [
  { key: '1m', label: '1分钟' },
  { key: '5m', label: '5分钟' },
  { key: '1h', label: '1小时' },
  { key: '1d', label: '1天' }
];

const containers = computed(() => projects.value.find(p => p.id === projectId.value)?.containers || []);
const containerAlerts = computed(() => alerts.value.filter(a => a.container === containerId.value));

const chartWidth = 800;
const chartHeight = 300;
const chartPadding = 40;

const chartPath = computed(() => {
  const metric = metricsData.value?.[selectedMetric.value];
  if (!metric?.trend) return '';
  
  // 模拟历史数据点
  const points = Array.from({ length: 20 }, (_, i) => {
    const base = metric.current;
    const variance = Math.random() * 10 - 5;
    return Math.max(0, Math.min(100, base + variance));
  });
  
  const maxY = Math.max(...points, 1);
  const stepX = (chartWidth - 2 * chartPadding) / (points.length - 1);
  const scaleY = (chartHeight - 2 * chartPadding) / maxY;
  
  return points.map((y, i) => {
    const x = chartPadding + i * stepX;
    const py = chartHeight - chartPadding - y * scaleY;
    return `${i === 0 ? 'M' : 'L'} ${x} ${py}`;
  }).join(' ');
});

function formatMetricValue(metric) {
  if (!metric) return '-';
  if (typeof metric.current === 'number') {
    return `${metric.current.toFixed(1)}${metric.unit}`;
  }
  if (metric.current?.rx !== undefined) {
    return metric.current.rx;
  }
  return '-';
}

function trendColor(trend) {
  if (trend === 'increasing') return 'text-rose-400';
  if (trend === 'decreasing') return 'text-emerald-400';
  return 'text-zinc-500';
}

function getAlertColor(metric) {
  const colors = {
    cpu: 'text-cyan-400',
    memory: 'text-emerald-400',
    network: 'text-amber-400',
    disk: 'text-rose-400'
  };
  return colors[metric] || 'text-zinc-400';
}

function onProjectChange() {
  containerId.value = '';
  metricsData.value = null;
}

async function loadProjects() {
  try {
    projects.value = ((await api.getProjects()).projects || []).filter(p => p.managed);
    if (projects.value.length === 1 && !projectId.value) {
      projectId.value = projects.value[0].id;
    }
  } catch {}
}

async function loadMetrics() {
  if (!containerId.value) return;
  loading.value = true;
  try {
    const results = await Promise.all(
      metricTypes.map(m => metricsApi.getContainerMetrics(containerId.value, m.key, period.value))
    );
    metricsData.value = {};
    metricTypes.forEach((m, i) => {
      metricsData.value[m.key] = results[i].data;
    });
  } catch (err) {
    console.error('加载指标失败:', err);
  } finally {
    loading.value = false;
  }
}

async function loadAlerts() {
  try {
    const res = await metricsApi.getAlerts();
    alerts.value = res.alerts || [];
  } catch {}
}

async function createAlertRule() {
  if (!containerId.value || !alertForm.value.metric || !alertForm.value.threshold) return;
  try {
    await metricsApi.createAlert({
      container: containerId.value,
      ...alertForm.value
    });
    showAlertModal.value = false;
    await loadAlerts();
  } catch (err) {
    console.error('创建告警规则失败:', err);
  }
}

async function deleteAlertRule(ruleId) {
  try {
    await metricsApi.deleteAlert(ruleId);
    await loadAlerts();
  } catch {}
}

onMounted(async () => {
  await loadProjects();
  await loadAlerts();
});
</script>

<style scoped>
.resource-monitor-view {
  padding: 1.5rem;
  min-height: 100vh;
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white;
  font-size: 0.875rem;
  font-weight: 500;
  border-radius: 0.5rem;
  transition: all 0.2s;
}

.btn-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #059669 0%, #047857 100%);
  transform: translateY(-1px);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  padding: 0.5rem 1rem;
  background: #27272a;
  color: #a1a1aa;
  font-size: 0.875rem;
  font-weight: 500;
  border-radius: 0.5rem;
  transition: all 0.2s;
}

.btn-secondary:hover {
  background: #3f3f46;
}

.input {
  width: 100%;
  padding: 0.5rem 0.75rem;
  background: #18181b;
  border: 1px solid #27272a;
  color: #fafafa;
  font-size: 0.875rem;
  border-radius: 0.375rem;
  transition: all 0.2s;
}

.input:focus {
  outline: none;
  border-color: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1);
}

.input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.metric-card {
  padding: 1rem;
  background: #09090b;
  border: 1px solid #27272a;
  border-radius: 0.75rem;
  cursor: pointer;
  transition: all 0.2s;
}

.metric-card:hover {
  border-color: #3f3f46;
  background: #18181b;
}

.metric-card-active {
  border-color: #10b981;
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.05), rgba(6, 182, 212, 0.05));
}

.chart-container {
  height: 300px;
  background: #09090b;
  border-radius: 0.5rem;
  padding: 1rem;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  backdrop-filter: blur(4px);
}

.modal-content {
  width: 100%;
  max-width: 28rem;
  background: #18181b;
  border: 1px solid #27272a;
  border-radius: 0.75rem;
  padding: 1.5rem;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
}
</style>
