<template>
  <div class="page-shell page-shell-workspace">
    <div class="page-header">
      <div><h1 class="page-title">存储资源</h1><p class="page-subtitle">逐项查看并清理悬空镜像、孤儿卷与闲置网络</p></div>
      <div class="page-actions">
        <button class="btn-secondary" :disabled="loading" @click="refresh"><RefreshCw class="w-4 h-4" :class="{ 'animate-spin': loading }" />刷新</button>
      </div>
    </div>

    <p v-if="error" class="alert-error">{{ error }}</p>
    <p v-if="flash" class="alert-info">{{ flash }}</p>

    <div class="flex flex-wrap items-center gap-2 text-xs text-surface-400">
      <span v-if="data" class="rounded border border-surface-800 bg-surface-950/50 px-2 py-0.5">悬空镜像 <b class="text-amber-300">{{ data.counts.danglingImages }}</b></span>
      <span v-if="data" class="rounded border border-surface-800 bg-surface-950/50 px-2 py-0.5">孤儿卷 <b class="text-amber-300">{{ data.counts.orphanVolumes }}</b></span>
      <span v-if="data" class="rounded border border-surface-800 bg-surface-950/50 px-2 py-0.5">闲置网络 <b class="text-amber-300">{{ data.counts.unusedNetworks }}</b></span>
    </div>

    <div class="flex items-center gap-1 border-b border-surface-800 pb-0">
      <button v-for="tab in tabs" :key="tab.key" class="nav-link !flex-none px-3 py-2 text-sm" :class="{ 'nav-link-active': activeTab === tab.key }" @click="activeTab = tab.key">{{ tab.label }}<span class="ml-2 count-badge">{{ (data?.counts?.[tab.countKey] ?? 0) }}</span></button>
    </div>

    <Skeleton v-if="loading && !data" variant="table" :rows="6" label="资源清单加载中" />

    <section v-if="data" class="section-panel flex-1 mt-4">
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th v-if="activeTab === 'images'">镜像</th>
              <th v-else-if="activeTab === 'volumes'">卷名</th>
              <th v-else>网络</th>
              <th>状态</th>
              <th class="text-right">大小</th>
              <th class="text-right min-w-24">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!rows.length"><td :colspan="5" class="text-center text-muted py-6">{{ activeTab === 'networks' ? '没有可清理的网络' : `没有${tabLabel}可清理,系统很干净` }}</td></tr>
            <tr v-for="row in rows" :key="row.key" class="hover:bg-surface-800/25">
              <td class="max-w-xs truncate font-mono tabular-nums" :title="row.title">{{ row.primary }}<span v-if="row.note" class="ml-2 text-muted text-xs">{{ row.note }}</span></td>
              <td><span class="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium" :class="row.toneCls">{{ row.statusLabel }}</span></td>
              <td class="text-right font-mono tabular-nums whitespace-nowrap">{{ formatBytes(row.size) }}</td>
              <td class="text-right">
                <button v-if="row.deletable" :class="pendingKey === row.key ? 'btn-danger' : 'btn-secondary'" :disabled="busy" @click="confirmRemove(row)">{{ pendingKey === row.key ? '确认删除?' : '删除' }}</button>
                <span v-else class="text-muted text-xs">{{ row.undeletableReason }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { RefreshCw } from 'lucide-vue-next';
import { api } from '../api/client.js';
import Skeleton from '../components/common/Skeleton.vue';

const data = ref(null);
const loading = ref(false);
const error = ref('');
const flash = ref('');
const activeTab = ref('images');
const pendingKey = ref('');
const busy = ref(false);

const tabs = [
  { key: 'images', label: '镜像', countKey: 'images' },
  { key: 'volumes', label: '卷', countKey: 'volumes' },
  { key: 'networks', label: '网络', countKey: 'networks' },
];
const tabLabel = computed(() => tabs.find((t) => t.key === activeTab.value)?.label || '');

// 状态徽章的调色板:tone -> tailwind 类(与 StatusBadge 的语义色对齐)
const TONE = {
  amber: 'text-amber-300 border-amber-500/30 bg-amber-500/10',
  sky: 'text-sky-300 border-sky-500/30 bg-sky-500/10',
  green: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10',
  slate: 'text-surface-400 border-surface-600/40 bg-surface-800/40',
};

const images = computed(() => data.value?.images || []);
const volumes = computed(() => data.value?.volumes || []);
const networks = computed(() => data.value?.networks || []);

const rows = computed(() => {
  if (activeTab.value === 'images') {
    return images.value.map((img) => ({
      key: `image:${img.id}`,
      primary: img.tags[0] || (img.id || '').slice(0, 12),
      title: img.tags.join('\n') || img.id,
      note: img.tags.length > 1 ? `+${img.tags.length - 1}` : '',
      tone: img.dangling ? 'amber' : img.inUse ? 'sky' : 'green',
      toneCls: TONE[img.dangling ? 'amber' : img.inUse ? 'sky' : 'green'],
      statusLabel: img.dangling ? '悬空' : img.inUse ? '使用中' : '未使用',
      size: img.size,
      deletable: !img.inUse,
      undeletableReason: img.inUse ? '被容器引用' : '',
    })).sort((a, b) => (a.deletable === b.deletable ? b.size - a.size : a.deletable ? -1 : 1));
  }
  if (activeTab.value === 'volumes') {
    return volumes.value.map((vol) => ({
      key: `volume:${vol.name}`,
      primary: vol.name,
      title: `driver=${vol.driver} scope=${vol.scope}\nmountpoint=${vol.mountpoint}`,
      tone: vol.orphan ? 'amber' : 'green',
      toneCls: TONE[vol.orphan ? 'amber' : 'green'],
      statusLabel: vol.orphan ? '孤儿' : `被引用 ×${vol.refCount}`,
      size: vol.size,
      deletable: vol.orphan,
      undeletableReason: '被容器挂载',
    })).sort((a, b) => (a.deletable === b.deletable ? b.size - a.size : a.deletable ? -1 : 1));
  }
  return networks.value.map((net) => ({
    key: `network:${net.id}`,
    primary: net.name,
    title: `driver=${net.driver} scope=${net.scope}${net.internal ? ' internal' : ''}`,
    tone: net.unused ? 'amber' : net.builtin ? 'slate' : 'green',
    toneCls: TONE[net.unused ? 'amber' : net.builtin ? 'slate' : 'green'],
    statusLabel: net.builtin ? '内置' : net.unused ? '闲置' : `接入 ${net.attached}`,
    size: 0,
    deletable: net.unused,
    undeletableReason: net.builtin ? 'Docker 内置' : `被 ${net.attached} 个容器使用`,
  })).sort((a, b) => Number(a.deletable) - Number(b.deletable));
});

async function refresh() {
  if (loading.value) return;
  loading.value = true;
  pendingKey.value = '';
  flash.value = '';
  try {
    data.value = await api.getStorageResources(true);
    error.value = '';
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function confirmRemove(row) {
  if (pendingKey.value === row.key) {
    await remove(row);
    return;
  }
  pendingKey.value = row.key;
  // 3 秒内未确认则复位,避免按钮长期停留在"确认"态
  setTimeout(() => { if (pendingKey.value === row.key) pendingKey.value = ''; }, 3000);
}

async function remove(row) {
  busy.value = true;
  const kinds = { images: 'image', volumes: 'volume', networks: 'network' };
  try {
    await api.removeStorageResource(kinds[activeTab.value], row.primary ? (activeTab.value === 'images' ? rowRemaining(row) : row.primary) : '');
    flash.value = `已删除 ${row.primary}`;
  } catch (e) {
    flash.value = '';
    error.value = `删除失败:${e.message}`;
  } finally {
    busy.value = false;
    pendingKey.value = '';
    await refresh();
  }
}

/** 镜像删除键是 Id 而非显示名;从 key 还原。 */
function rowRemaining(row) {
  return row.key.split(':').slice(1).join(':');
}

function formatBytes(value = 0) {
  if (!value) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = value, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}

onMounted(refresh);
</script>