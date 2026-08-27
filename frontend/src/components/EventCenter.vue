<template>
  <div class="relative">
    <button class="icon-btn relative" title="事件中心" aria-label="打开事件中心" @click="toggle">
      <Bell class="h-4 w-4" />
      <span v-if="eventCount" class="event-count">{{ eventCount > 9 ? '9+' : eventCount }}</span>
    </button>
    <div v-if="open" class="fixed inset-0 z-40" @click="open = false"></div>
    <section v-if="open" class="event-panel">
      <header class="flex items-center justify-between border-b border-surface-800 px-4 py-3">
        <div><h2 class="text-sm font-semibold text-surface-100">事件中心</h2><p class="mt-0.5 text-muted">需要关注的运行状态与系统操作</p></div>
        <button class="icon-btn" title="刷新" aria-label="刷新事件" :disabled="loading" @click="load"><RefreshCw class="h-4 w-4" :class="{ 'animate-spin': loading }" /></button>
      </header>
      <div class="max-h-[min(68vh,32rem)] overflow-y-auto p-2">
        <router-link v-for="event in events" :key="event.key" :to="event.to" class="event-item" @click="open = false">
          <span class="event-icon" :class="event.tone"><component :is="event.icon" class="h-4 w-4" /></span>
          <span class="min-w-0 flex-1"><strong>{{ event.title }}</strong><small>{{ event.detail }}</small></span>
          <ChevronRight class="h-4 w-4 shrink-0 text-surface-600" />
        </router-link>
        <EmptyState icon="CircleCheckBig" icon-class="text-emerald-400" compact title="当前没有待处理事件" description="异常与告警事件会出现在这里" />
      </div>
      <footer class="flex items-center justify-between border-t border-surface-800 px-4 py-2.5 text-muted">
        <span>{{ eventCount }} 个需要关注</span>
        <router-link to="/operations" class="text-accent hover:text-blue-300" @click="open = false">打开操作中心</router-link>
      </footer>
    </section>
  </div>
</template>

<script setup>
import { computed, markRaw, onMounted, onUnmounted, ref } from 'vue';
import { AlertTriangle, Bell, ChevronRight, CircleCheckBig, CircleX, RefreshCw, RefreshCwOff } from 'lucide-vue-next';
import { api } from '../api/client.js';
import EmptyState from './common/EmptyState.vue';

const open = ref(false);
const loading = ref(false);
const projects = ref([]);
const operations = ref([]);
const updates = ref({ lastResults: [] });
const jobs = ref([]);
let timer;

const events = computed(() => {
  const result = [];
  const since = Date.now() - 24 * 60 * 60 * 1000;
  for (const job of jobs.value.filter((item) => ['queued', 'running'].includes(item.status) || (['failed', 'interrupted'].includes(item.status) && new Date(`${item.createdAt}Z`).getTime() >= since)).slice(0, 4)) {
    const abnormal = ['failed', 'interrupted'].includes(job.status);
    result.push({
      key: `job-${job.id}`,
      title: job.status === 'failed' ? '批量任务执行失败' : job.status === 'interrupted' ? '批量任务意外中断' : '批量任务执行中',
      detail: `${job.action} · ${job.completed}/${job.total} 个项目`,
      to: `/operations?tab=jobs&job=${job.id}`,
      icon: markRaw(abnormal ? CircleX : RefreshCw),
      tone: abnormal ? 'danger' : 'info',
    });
  }
  for (const project of projects.value) {
    const unhealthy = project.containers.filter((container) => container.health === 'unhealthy').length;
    const stopped = project.containers.filter((container) => container.state !== 'running').length;
    if (project.status !== 'running' || unhealthy) {
      result.push({
        key: `project-${project.id}`,
        title: project.projectName,
        detail: unhealthy ? `${unhealthy} 个容器健康检查失败` : stopped ? `${stopped} 个容器未运行` : '项目状态异常',
        to: `/services?focus=${project.id}`,
        icon: markRaw(AlertTriangle),
        tone: project.status === 'stopped' ? 'danger' : 'warning',
      });
    }
  }
  for (const item of operations.value.filter((operation) => operation.status !== 'success' && new Date(`${operation.createdAt}Z`).getTime() >= since).slice(0, 5)) {
    result.push({
      key: `operation-${item.id}`,
      title: item.projectName || '系统操作失败',
      detail: item.detail || item.action,
      to: '/operations?status=failed',
      icon: markRaw(CircleX),
      tone: 'danger',
    });
  }
  const pendingImages = (updates.value.lastResults || []).filter((item) => item.status === 'updated' && projects.value.some((project) =>
    project.containers.some((container) => container.image === item.image && container.imageId !== item.after)
  ));
  if (pendingImages.length) {
    result.push({
      key: 'image-updates',
      title: `${pendingImages.length} 个镜像待应用`,
      detail: '相关项目需要重新创建容器后生效',
      to: '/settings?tab=maintenance',
      icon: markRaw(RefreshCwOff),
      tone: 'info',
    });
  }
  return result.slice(0, 12);
});
const eventCount = computed(() => events.value.length);

async function load() {
  if (loading.value) return;
  loading.value = true;
  try {
    const [projectData, operationData, updateData, jobData] = await Promise.all([api.getProjects(), api.getOperations(), api.getUpdateSettings(), api.listJobs(20)]);
    projects.value = projectData.projects || [];
    operations.value = operationData.operations || [];
    updates.value = updateData || { lastResults: [] };
    jobs.value = jobData.jobs || [];
  } catch {}
  finally { loading.value = false; }
}
function toggle() { open.value = !open.value; if (open.value) load(); }

onMounted(() => { load(); timer = setInterval(load, 30000); });
onUnmounted(() => clearInterval(timer));
</script>
