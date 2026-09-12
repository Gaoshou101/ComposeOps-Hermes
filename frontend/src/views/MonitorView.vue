<template>
  <div class="page-shell">
    <div class="page-header"><div><h1 class="page-title">实时监控</h1><p class="page-subtitle">{{ scopeLabel }}</p></div><div class="page-actions"><label class="toggle-label"><input v-model="autoRefresh" type="checkbox" />自动刷新</label><button class="btn-secondary" @click="refresh"><RefreshCw class="w-4 h-4" :class="{ 'animate-spin': loading }" />刷新</button></div></div>
    <p v-if="error" class="alert-error">{{ error }}</p>
    <Skeleton v-if="loading && !data" variant="table" :rows="6" label="监控数据加载中" />
    <div v-if="data" class="grid grid-cols-2 xl:grid-cols-4 gap-4"><StatCard title="环境 CPU" :value="`${data.host.cpu.percent}%`" :sub="`${data.host.cpu.cores} 核 · Load ${numberValue(data.host.cpu.loadavg?.[0]).toFixed(2)}`" tone="bg-sky-400" :trend="trends.cpu"/><StatCard title="环境内存" :value="formatBytes(data.host.memory.used)" :sub="`${data.host.memory.percent}% / ${formatBytes(data.host.memory.total)}`" tone="bg-emerald-400" :trend="trends.mem"/><StatCard title="网络速率" :value="`↓ ${formatRate(data.network.rx)}`" :sub="`↑ ${formatRate(data.network.tx)}`" tone="bg-violet-400" :trend="trends.net"/><StatCard title="运行时间" :value="formatUptime(data.host.uptime)" :sub="lastUpdated"/></div>
    <div v-if="data" class="flex flex-wrap items-center gap-2 text-xs text-surface-400">
      <span class="font-semibold text-surface-300">告警阈值</span>
      <span class="rounded border border-sky-900/50 bg-sky-950/30 px-2 py-0.5">CPU ≥ <b class="text-sky-300">{{ alertThresholds.cpu }}%</b></span>
      <span class="rounded border border-emerald-900/50 bg-emerald-950/30 px-2 py-0.5">内存 ≥ <b class="text-emerald-300">{{ alertThresholds.mem }}%</b></span>
      <span v-if="crossedThreshold" class="rounded border border-rose-900/50 bg-rose-950/40 px-2 py-0.5 text-rose-300">当前已超出阈值!</span>
      <button class="ml-auto text-surface-500 hover:text-surface-200" @click="resetTrends">重置趋势</button>
    </div>
    <section class="section-panel flex-1"><div class="mb-4 flex items-center justify-between gap-3"><div><h2 class="section-title">容器资源</h2><p class="mt-1 text-muted">实时 CPU、内存占用与容器镜像</p></div><span class="count-badge">{{ data?.containers?.length || 0 }} 个容器</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>容器</th><th>镜像</th><th class="text-right">CPU</th><th class="text-right">内存</th><th class="min-w-32">内存占用</th></tr></thead><tbody><tr v-for="c in data?.containers || []" :key="c.id" class="hover:bg-surface-800/25"><td class="font-mono tabular-nums">{{ c.name }}<span v-if="histories[c.id]?.cpu.length > 1" class="ml-2 inline-flex gap-2 align-middle"><span class="metric-chip" :class="c.cpuPercent >= 85 ? 'bg-rose-950/50 text-rose-300' : 'text-sky-300'">CPU {{ numberValue(c.cpuPercent).toFixed(1) }}%</span><span class="metric-chip" :class="c.memPercent >= 90 ? 'bg-rose-950/50 text-rose-300' : 'text-emerald-300'">MEM {{ numberValue(c.memUsage / 1024 / 1024).toFixed(0) }}MB</span><SparklineChart :cpu="histories[c.id]?.cpu || []" :mem="histories[c.id]?.mem || []" :width="64" :height="20" /></span></td><td class="max-w-64 truncate" :title="c.image">{{ c.image }}</td><td class="text-right font-mono tabular-nums">{{ c.cpuPercent }}%</td><td class="text-right font-mono tabular-nums whitespace-nowrap">{{ formatBytes(c.memUsage) }}</td><td><div class="progress progress-muted"><span :style="{ width: Math.min(100, c.memPercent) + '%' }"></span></div><div class="text-muted mt-1 font-mono tabular-nums">{{ c.memPercent }}%</div></td></tr></tbody></table></div></section>
    <section v-if="usage" class="section-panel"><div class="mb-4"><h2 class="section-title">Docker 存储</h2><p class="mt-1 text-muted">镜像、构建缓存和可回收空间</p></div><div class="grid sm:grid-cols-3 gap-4"><StatCard title="镜像" :value="formatBytes(usage.images.total)" :sub="`可回收 ${formatBytes(usage.images.reclaimable)}`"/><StatCard title="构建缓存" :value="formatBytes(usage.buildCache.total)" :sub="`可回收 ${formatBytes(usage.buildCache.reclaimable)}`"/><StatCard title="总计可回收" :value="formatBytes(usage.reclaimable)" sub="可在设置中预览并清理"/></div></section>
  </div>
</template>
<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'; import { RefreshCw } from 'lucide-vue-next'; import { api } from '../api/client.js'; import StatCard from '../components/StatCard.vue'; import SparklineChart from '../components/common/SparklineChart.vue'; import Skeleton from '../components/common/Skeleton.vue';
const data = ref(null); const usage = ref(null); const capabilities = ref({}); const autoRefresh = ref(true); const error = ref(''); const loading = ref(false); const lastUpdated = ref(''); const intervalMs = ref(5000); const histories = ref({}); const trends = ref(loadTrends()); const crossedThreshold = ref(false); let timer;
const alertThresholds = { cpu: 85, mem: 90 };
const TRENDS_KEY = 'composeops:monitor-trends';
function loadTrends() {
  try {
    const saved = JSON.parse(localStorage.getItem(TRENDS_KEY) || '{}');
    return { cpu: Array.isArray(saved.cpu) ? saved.cpu : [], mem: Array.isArray(saved.mem) ? saved.mem : [], net: Array.isArray(saved.net) ? saved.net : [] };
  } catch { return { cpu: [], mem: [], net: [] }; }
}
function saveTrends() {
  try { localStorage.setItem(TRENDS_KEY, JSON.stringify({ cpu: trends.value.cpu.slice(-96), mem: trends.value.mem.slice(-96), net: trends.value.net.slice(-96), ts: Date.now() })); } catch {}
}
const scopeLabel = computed(() => capabilities.value.hostMetricsScope === 'host' ? '宿主机与 Docker 容器实时指标' : 'ComposeOps 运行环境与 Docker 容器指标');
async function refresh() { if (loading.value) return; loading.value = true; try { [data.value, usage.value] = await Promise.all([api.getMetrics(), api.getDockerUsage()]); accumulate(); lastUpdated.value = `更新于 ${new Date().toLocaleTimeString()}`; error.value = ''; } catch (e) { error.value = e.message; } finally { loading.value = false; } }
function accumulate() {
  const next = { ...histories.value };
  for (const c of data.value?.containers || []) {
    const prev = next[c.id] || { cpu: [], mem: [] };
    prev.cpu = [...prev.cpu, c.cpuPercent].slice(-96);
    prev.mem = [...prev.mem, c.memPercent].slice(-96);
    next[c.id] = prev;
  }
  histories.value = next;
  if (data.value) {
    trends.value.cpu.push(data.value.host.cpu.percent);
    trends.value.mem.push(data.value.host.memory.percent);
    const rx = data.value.network?.rx || 0;
    trends.value.net.push(Math.max(1, Math.round((rx / 1024 / 1024) * 100) / 100));
    trends.value.cpu = trends.value.cpu.slice(-96);
    trends.value.mem = trends.value.mem.slice(-96);
    trends.value.net = trends.value.net.slice(-96);
    crossedThreshold.value = data.value.host.cpu.percent >= alertThresholds.cpu || data.value.host.memory.percent >= alertThresholds.mem;
    saveTrends();
  }
}
function setTimer(value) { clearInterval(timer); if (value) timer = setInterval(refresh, intervalMs.value); }
function numberValue(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; } function formatBytes(value = 0) { const units = ['B','KB','MB','GB','TB']; let n = numberValue(value), i = 0; while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; } return `${n.toFixed(i ? 1 : 0)} ${units[i]}`; } function formatRate(n) { return `${formatBytes(n)}/s`; } function formatUptime(s) { const d = Math.floor(numberValue(s) / 86400), h = Math.floor((numberValue(s) % 86400) / 3600), m = Math.floor((numberValue(s) % 3600) / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; }
watch(autoRefresh, setTimer); function onHostChanged() { histories.value = {}; try { localStorage.removeItem(TRENDS_KEY); } catch {} trends.value = { cpu: [], mem: [], net: [] }; void refresh(); }
function resetTrends() { try { localStorage.removeItem(TRENDS_KEY); } catch {} trends.value = { cpu: [], mem: [], net: [] }; }
onMounted(async () => { const [caps, prefs] = await Promise.all([api.getCapabilities(), api.getPreferences()]); capabilities.value = caps; intervalMs.value = prefs.refreshInterval * 1000; await refresh(); setTimer(true); window.addEventListener('composeops:host-changed', onHostChanged); }); onUnmounted(() => { clearInterval(timer); window.removeEventListener('composeops:host-changed', onHostChanged); });
</script>
