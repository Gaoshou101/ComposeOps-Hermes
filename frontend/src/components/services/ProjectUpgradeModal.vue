<template>
  <div class="modal-backdrop z-[55]" @click.self="close">
    <div class="modal max-w-[calc(100vw-2rem)] sm:max-w-2xl flex max-h-[88vh] flex-col">
      <div class="modal-header shrink-0"><span class="flex items-center gap-2"><Sparkles class="w-4 h-4 text-accent" />镜像更新 · {{ project.projectName }}</span><button class="icon-btn" title="关闭" @click="close"><X class="w-4 h-4" /></button></div>
      <div class="min-h-0 flex-1 overflow-y-auto p-4 space-y-3">
        <p v-if="error" class="alert-error">{{ error }}</p>
        <div v-if="!data && !error" class="text-muted py-8 text-center">正在检测镜像更新…</div>
        <template v-else-if="data">
          <div class="flex items-center gap-2">
            <span class="count-badge" :class="data.hasUpdate ? 'text-amber-300' : 'text-emerald-300'">{{ data.hasUpdate ? '有可用更新' : '已是最新' }}</span>
            <span class="text-muted text-xs">{{ formatTime(data.checkedAt) }} 检测</span>
            <button class="icon-btn ml-auto" title="立即刷新" :disabled="refreshing" @click="refresh"><RefreshCw class="w-4 h-4" :class="{ 'animate-spin': refreshing }" /></button>
          </div>
          <div class="space-y-2">
            <div v-for="image in data.images" :key="image.image" class="card p-3">
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full" :class="image.hasUpdate ? 'bg-amber-400' : image.reachable ? 'bg-emerald-400' : 'bg-surface-600'"></span>
                <strong class="font-mono text-sm flex-1 min-w-0 truncate">{{ image.image }}</strong>
                <span v-if="image.hasUpdate" class="count-badge text-amber-300">可升级</span>
                <span v-else-if="image.reachable" class="count-badge text-emerald-300">最新</span>
              </div>
              <div class="mt-2 grid grid-cols-2 gap-2 text-[11px] font-mono text-surface-400">
                <div class="min-w-0"><span class="text-surface-600">本地 </span><span class="truncate block">{{ shortDigest(image.localDigest) }}</span></div>
                <div class="min-w-0"><span class="text-surface-600">远端 </span><span class="truncate block">{{ shortDigest(image.remoteDigest) }}</span></div>
              </div>
              <p v-if="image.error" class="mt-1 text-[11px] text-rose-400">检测失败:{{ image.error }}</p>
            </div>
          </div>
          <div class="rounded-xl border border-surface-800 bg-surface-950/40 p-3 text-xs text-surface-400">
            <p>升级前会自动备份 <code class="font-mono text-surface-300">docker-compose.yml</code> 与 <code class="font-mono text-surface-300">.env</code>;升级完成后 15 秒内自动健康检查,若容器异常退出可一键回滚。</p>
          </div>
        </template>
      </div>
      <div class="flex shrink-0 items-center justify-end gap-2 border-t border-surface-800 p-3">
        <button v-if="data?.hasUpdate && !upgrading" class="btn-primary" @click="upgrade"><Zap class="w-4 h-4" />一键平滑升级</button>
        <span v-if="upgrading" class="text-sm text-muted">正在升级,请查看输出面板…</span>
        <button class="btn-secondary" @click="close">关闭</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useEscapeKey } from '../../composables/useEscapeKey.js';
import { api } from '../../api/client.js';
import { useToastStore } from '../../stores/toast.js';
import { RefreshCw, Sparkles, X, Zap } from 'lucide-vue-next';

const props = defineProps({
  project: { type: Object, required: true },
  open: { type: Boolean, default: true },
});
const emit = defineEmits(['close', 'upgrade']);
const toast = useToastStore();
const data = ref(null);
const error = ref('');
const refreshing = ref(false);
const upgrading = ref(false);

const active = computed(() => props.open);

async function load(force = false) {
  error.value = '';
  if (force) refreshing.value = true;
  try {
    data.value = await api.getProjectUpdates(props.project.id, force);
  } catch (e) {
    error.value = e.message;
  } finally {
    refreshing.value = false;
  }
}
function refresh() { void load(true); }
function upgrade() {
  if (upgrading.value) return;
  upgrading.value = true;
  toast.info('已开始平滑升级,请查看输出面板');
  emit('upgrade', props.project);
}
function close() { emit('close'); }
function formatTime(ts) { return ts ? new Date(ts).toLocaleString() : ''; }
function shortDigest(digest) { return digest ? `${String(digest).slice(7, 17)}…${String(digest).slice(-8)}` : '未知'; }
onMounted(() => void load());
useEscapeKey({ active, onClose: close, layer: 'modal', lockBody: true });
</script>
