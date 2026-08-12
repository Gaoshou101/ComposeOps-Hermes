<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-semibold">服务总览</h1>
        <p class="text-sm text-surface-400">按 <code class="text-accent">myops.owner</code> 标签分组的 Compose 项目</p>
      </div>
      <div class="flex items-center gap-2">
        <label class="text-sm text-surface-400 flex items-center gap-1">
          <input type="checkbox" v-model="autoRefresh" class="accent-accent" /> 自动刷新
        </label>
        <button class="btn-secondary" @click="refresh" :disabled="store.loading">
          {{ store.loading ? '刷新中…' : '刷新' }}
        </button>
      </div>
    </div>

    <p v-if="store.error" class="text-red-400 text-sm">{{ store.error }}</p>

    <div v-if="store.groups.length === 0 && !store.loading" class="card p-8 text-center text-surface-400">
      暂未发现带 <code class="text-accent">com.docker.compose.project</code> 标签的容器。
    </div>

    <div v-for="group in store.groups" :key="group.owner" class="space-y-2">
      <div class="flex items-center gap-2">
        <h2 class="text-lg font-medium">{{ group.owner }}</h2>
        <span class="text-xs text-surface-500">{{ group.projects.length }} 个项目</span>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div
          v-for="p in group.projects"
          :key="p.workingDir"
          class="card p-4 hover:border-surface-700 transition-colors"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="font-mono text-sm truncate" :title="p.workingDir">{{ p.name }}</div>
              <div class="text-xs text-surface-500 truncate">{{ p.workingDir }}</div>
            </div>
            <StatusBadge :status="p.status" />
          </div>

          <div class="mt-3 flex flex-wrap gap-1.5">
            <button class="btn-primary" @click="control(p, 'up')">up</button>
            <button class="btn-secondary" @click="control(p, 'down')">down</button>
            <button class="btn-secondary" @click="control(p, 'restart')">restart</button>
            <button class="btn-secondary" @click="control(p, 'pull')">pull</button>
            <button class="btn-ghost" @click="control(p, 'ps')">ps</button>
            <router-link class="btn-ghost" :to="`/logs?project=${encodeURIComponent(p.name)}`">logs</router-link>
            <router-link class="btn-ghost" :to="`/compose?path=${encodeURIComponent(p.workingDir)}`">编辑</router-link>
          </div>

          <div class="mt-3 flex flex-wrap gap-1.5">
            <span
              v-for="s in p.services"
              :key="s.name"
              class="text-xs px-1.5 py-0.5 rounded bg-surface-800 text-surface-300"
              :class="s.state === 'running' ? 'text-green-400' : 'text-surface-500'"
              :title="s.state"
            >
              {{ s.name }} ({{ s.state }})
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- 控制输出抽屉 -->
    <div
      v-if="output.open"
      class="fixed bottom-0 right-0 w-full md:w-[600px] h-72 card border-t border-surface-700 flex flex-col shadow-2xl z-50"
    >
      <div class="flex items-center justify-between px-3 py-2 border-b border-surface-800">
        <span class="text-sm font-medium">compose {{ output.action }} — {{ output.name }}</span>
        <button class="btn-ghost" @click="output.open = false">关闭</button>
      </div>
      <pre class="flex-1 overflow-auto p-3 text-xs font-mono whitespace-pre-wrap">{{ output.text }}</pre>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted, reactive } from 'vue';
import { useServicesStore } from '../stores/services.js';
import { streamComposeControl } from '../api/client.js';
import StatusBadge from '../components/StatusBadge.vue';

const store = useServicesStore();
const autoRefresh = ref(true);
const output = reactive({ open: false, text: '', action: '', name: '' });

function refresh() {
  store.refresh();
}

async function control(project, action) {
  output.open = true;
  output.text = `$ docker compose ${action}\n`;
  output.action = action;
  output.name = project.name;
  try {
    await streamComposeControl(
      { workingDir: project.workingDir, action },
      (frame) => {
        if (frame.type === 'stdout' || frame.type === 'stderr') {
          output.text += frame.data;
        } else if (frame.type === 'exit') {
          output.text += `\n[exit ${frame.data}]\n`;
        }
      }
    );
    refresh();
  } catch (e) {
    output.text += `\n[error] ${e.message}\n`;
  }
}

watch(autoRefresh, (v) => (v ? store.startAutoRefresh() : store.stopAutoRefresh()));
onMounted(() => {
  if (autoRefresh.value) store.startAutoRefresh();
});
onUnmounted(() => store.stopAutoRefresh());
</script>
