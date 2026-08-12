<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold">系统监控</h1>
      <div class="flex items-center gap-2">
        <label class="text-sm text-surface-400 flex items-center gap-1">
          <input type="checkbox" v-model="autoRefresh" class="accent-accent" /> 自动刷新
        </label>
        <span class="text-xs text-surface-500" v-if="data">更新于 {{ ts }}</span>
      </div>
    </div>

    <p v-if="error" class="text-red-400 text-sm">{{ error }}</p>

    <div v-if="data" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
      <StatCard title="CPU" :value="`${data.host.cpu.percent}%`" :sub="`${data.host.cpu.cores} 核 · load ${data.host.cpu.loadavg[0].toFixed(2)}`" />
      <StatCard title="内存" :value="formatBytes(data.host.memory.used) + ' / ' + formatBytes(data.host.memory.total)" :sub="`${data.host.memory.percent}%`" />
      <StatCard title="网络速率" :value="`↓${formatRate(data.network.rx)} ↑${formatRate(data.network.tx)}`" :sub="`累计 ↓${formatBytes(data.network.rxTotal || 0)} ↑${formatBytes(data.network.txTotal || 0)}`" />
      <StatCard title="运行时长" :value="formatUptime(data.host.uptime)" :sub="data.host.hostname" />
    </div>

    <div v-if="data?.disk?.length" class="card p-4">
      <h2 class="text-sm font-medium mb-3 text-surface-300">磁盘</h2>
      <div class="space-y-2">
        <div v-for="d in data.disk" :key="d.mountpoint">
          <div class="flex justify-between text-xs mb-1">
            <span class="font-mono">{{ d.mountpoint }}</span>
            <span class="text-surface-400">{{ formatBytes(d.used) }} / {{ formatBytes(d.total) }} · {{ d.percent }}%</span>
          </div>
          <div class="h-2 bg-surface-800 rounded">
            <div class="h-2 bg-accent rounded" :style="{ width: Math.min(100, d.percent) + '%' }"></div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="data?.containers?.length" class="card p-4">
      <h2 class="text-sm font-medium mb-3 text-surface-300">容器资源 Top 5</h2>
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-surface-500 text-xs">
            <th class="py-2">容器</th>
            <th class="py-2">镜像</th>
            <th class="py-2 text-right">CPU</th>
            <th class="py-2 text-right">内存</th>
            <th class="py-2 w-40">占用</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in data.containers" :key="c.id" class="border-t border-surface-800">
            <td class="py-2 font-mono text-xs">{{ c.name }}</td>
            <td class="py-2 text-xs text-surface-400 truncate max-w-[200px]" :title="c.image">{{ c.image }}</td>
            <td class="py-2 text-right font-mono">{{ c.cpuPercent }}%</td>
            <td class="py-2 text-right font-mono">{{ formatBytes(c.memUsage) }} / {{ formatBytes(c.memLimit) }}</td>
            <td class="py-2">
              <div class="h-2 bg-surface-800 rounded">
                <div class="h-2 bg-accent rounded" :style="{ width: Math.min(100, c.memPercent) + '%' }"></div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { api } from '../api/client.js';
import StatCard from '../components/StatCard.vue';

const data = ref(null);
const error = ref('');
const autoRefresh = ref(true);
const ts = ref('');
let timer;

async function refresh() {
  try {
    data.value = await api.getMetrics();
    error.value = '';
    ts.value = new Date().toLocaleTimeString();
  } catch (e) {
    error.value = e.message;
  }
}

function formatBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}
function formatRate(n) {
  // 后端返回的是字节/秒
  return formatBytes(n) + '/s';
}
function formatUptime(s) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

watch(autoRefresh, (v) => {
  if (v) { refresh(); timer = setInterval(refresh, 3000); }
  else clearInterval(timer);
});
onMounted(() => { refresh(); if (autoRefresh.value) timer = setInterval(refresh, 3000); });
onUnmounted(() => clearInterval(timer));
</script>
