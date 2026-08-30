<template>
  <div class="page-shell">
    <div class="page-header">
      <div><h1 class="page-title">应用市场</h1><p class="page-subtitle">精选自托管应用模板,一键部署到你当前的 Docker 节点</p></div>
      <div class="page-actions">
        <label class="search-field"><Search class="h-4 w-4" /><input v-model="query" placeholder="搜索应用…" /></label>
      </div>
    </div>
    <div class="flex flex-wrap gap-1.5">
      <button v-for="category in categories" :key="category" class="btn-ghost" :class="{ 'bg-surface-800 text-surface-100': filter === category }" @click="filter = filter === category ? 'all' : category">{{ category === 'all' ? '全部' : category }}</button>
    </div>
    <div v-if="error" class="alert-error">{{ error }}</div>
    <div v-if="!blueprints.length && !error" class="text-muted py-10 text-center">正在加载应用模板…</div>
    <div v-else-if="filtered.length" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <article v-for="blueprint in filtered" :key="blueprint.id" class="card p-4 flex flex-col gap-3">
        <div class="flex items-start gap-3">
          <span class="blueprint-icon">{{ blueprint.icon }}</span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <strong class="truncate text-sm text-surface-100">{{ blueprint.name }}</strong>
              <span v-if="blueprint.featured" class="count-badge text-amber-300">推荐</span>
            </div>
            <p class="mt-1 text-muted text-xs leading-5">{{ blueprint.description }}</p>
          </div>
        </div>
        <div class="mt-auto flex items-center justify-between">
          <span class="count-badge">{{ blueprint.category }}</span>
          <button class="btn-primary" @click="deploy(blueprint)"><Zap class="w-4 h-4" />一键部署</button>
        </div>
      </article>
    </div>
    <EmptyState v-else icon="Search" title="没有匹配的应用" description="调整关键词或分类后重试" />
    <BlueprintDeployModal v-if="selected" :blueprint="selected" :open="!!selected" @close="selected = null" @deployed="handleDeployed" />
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Search, Zap } from 'lucide-vue-next';
import { api } from '../api/client.js';
import EmptyState from '../components/common/EmptyState.vue';
import BlueprintDeployModal from '../components/services/BlueprintDeployModal.vue';
import { useToastStore } from '../stores/toast.js';

const router = useRouter();
const toast = useToastStore();
const blueprints = ref([]);
const error = ref('');
const query = ref('');
const filter = ref('all');
const selected = ref(null);
const categories = computed(() => ['all', ...new Set(blueprints.value.map((item) => item.category))]);
const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return blueprints.value.filter((item) =>
    (filter.value === 'all' || item.category === filter.value) &&
    (!needle || `${item.name} ${item.description} ${item.category}`.toLowerCase().includes(needle))
  );
});

function deploy(blueprint) { selected.value = blueprint; }
function handleDeployed(data) {
  selected.value = null;
  toast.success('部署完成,正在跳转服务列表');
  router.push('/services');
}
onMounted(async () => {
  try { blueprints.value = (await api.getBlueprints()).blueprints || []; } catch (e) { error.value = e.message; }
});
</script>
