<template>
  <div class="marketplace-view">
    <header class="page-header">
      <h1>应用市场</h1>
<div class="actions">
        <button @click="openAgentRecommend" class="btn-secondary"><Bot class="w-4 h-4" />让 Agent 推荐</button>
        <button @click="openAiDiscover" class="btn-secondary" :disabled="aiDiscovering"><Sparkles class="w-4 h-4" :class="{ 'animate-pulse': aiDiscovering }" />{{ aiDiscovering ? 'AI 查找中...' : 'AI 找应用' }}</button>
        <button @click="showCreateModal = true" class="btn-primary">
          <span class="icon">+</span>
          创建模板
        </button>
      </div>
    </header>

    <!-- 搜索和筛选 -->
    <section class="filter-bar">
      <div class="search-box">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索模板..."
          class="search-input"
          @input="handleSearch"
        />
      </div>
      <div class="filters">
        <select v-model="selectedSource" @change="loadTemplates" class="filter-select">
          <option value="all">全部来源</option>
          <option value="builtin">内置模板</option>
          <option value="community">社区模板</option>
          <option value="custom">自定义模板</option>
        </select>
        <select v-model="selectedCategory" @change="loadTemplates" class="filter-select">
          <option value="all">全部分类</option>
          <option v-for="cat in stats.categories" :key="cat" :value="cat">{{ cat }}</option>
        </select>
        <label class="favorites-toggle">
          <input type="checkbox" v-model="onlyFavorites" @change="loadTemplates" />
          <span>仅收藏</span>
        </label>
      </div>
    </section>

    <!-- 统计卡片 -->
    <section v-if="stats" class="stats-grid">
      <div class="stat-card">
        <div class="label">内置模板</div>
        <div class="value">{{ stats.totalBuiltin }}</div>
      </div>
      <div class="stat-card">
        <div class="label">社区模板</div>
        <div class="value">{{ stats.totalCommunity }}</div>
      </div>
      <div class="stat-card">
        <div class="label">自定义模板</div>
        <div class="value">{{ stats.totalCustom }}</div>
      </div>
      <div class="stat-card" :class="{ highlight: stats.totalFavorites > 0 }">
        <div class="label">我的收藏</div>
        <div class="value">{{ stats.totalFavorites }}</div>
      </div>
    </section>

    <div v-if="loading" class="loading-state">
      <div class="spinner"></div>
      <p>加载模板...</p>
    </div>

    <div v-else-if="error" class="error-state">
      <p>{{ error }}</p>
      <button @click="loadTemplates" class="btn-retry">重试</button>
    </div>

    <!-- 模板列表 -->
    <section v-else class="templates-grid">
      <div
        v-for="template in filteredTemplates"
        :key="template.id"
        class="template-card"
        :class="{ featured: template.featured }"
      >
        <div class="card-header">
          <h3>{{ template.name }}<span v-if="template.featured" class="featured-badge">精选</span></h3>
          <button
            @click="toggleFavorite(template.id)"
            class="favorite-btn"
            :class="{ active: template.favorited }"
          >
            ★
          </button>
        </div>
        <div class="card-body">
          <div class="meta">
            <span class="category-badge">{{ template.category }}</span>
            <span class="source-badge">{{ getSourceLabel(template.id) }}</span>
          </div>
          <p class="description">{{ template.description || '暂无描述' }}</p>
          <div v-if="template.author" class="author">作者: {{ template.author }}</div>
          <div v-if="template.downloads" class="stats-row">
            <span>下载: {{ template.downloads }}</span>
            <span v-if="template.rating">评分: {{ template.rating }}/5</span>
          </div>
        </div>
        <div class="card-actions">
          <button @click="viewTemplate(template)" class="btn-view">查看</button>
          <button v-if="isDeployableTemplate(template)" @click="openDeploy(template)" class="btn-deploy">
            <Rocket class="w-4 h-4" />部署
          </button>
          <button
            v-if="isCustomTemplate(template)"
            @click="editTemplate(template)"
            class="btn-edit"
          >
            编辑
          </button>
          <button
            v-if="isCustomTemplate(template)"
            @click="deleteTemplate(template.id)"
            class="btn-delete"
          >
            删除
          </button>
        </div>
      </div>
    </section>

    <!-- 创建/编辑模态框 -->
    <div v-if="showCreateModal || editingTemplate" class="modal-overlay" @click.self="closeModal">
      <div class="modal-content">
        <div class="modal-header">
          <h2>{{ editingTemplate ? '编辑模板' : '创建模板' }}</h2>
          <button @click="closeModal" class="close-btn">×</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>模板名称</label>
            <input v-model="formData.name" type="text" placeholder="例如: LNMP Stack" />
          </div>
          <div class="form-group">
            <label>分类</label>
            <input v-model="formData.category" type="text" placeholder="例如: Web" />
          </div>
          <div class="form-group">
            <label>描述</label>
            <textarea v-model="formData.description" rows="3" placeholder="简要描述模板用途"></textarea>
          </div>
          <div class="form-group">
            <label>Compose 内容</label>
            <textarea v-model="formData.defaultCompose" rows="10" placeholder="version: '3'..."></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button @click="closeModal" class="btn-cancel">取消</button>
          <button @click="saveTemplate" class="btn-save">保存</button>
        </div>
      </div>
    </div>

    <!-- AI 发现应用模态框 -->
    <div v-if="showAiModal" class="modal-overlay" @click.self="showAiModal = false">
      <div class="modal-content">
        <div class="modal-header">
          <h2>AI 找应用</h2>
          <button @click="showAiModal = false" class="close-btn">×</button>
        </div>
        <div class="modal-body">
          <p class="text-xs text-zinc-500 mb-3">输入应用名,Agent 会联网检索官方部署方式并生成可一键部署的 Compose 模板草稿,确认后保存为自定义模板。</p>
          <div class="form-group">
            <label>应用名称</label>
            <input v-model="aiQuery" type="text" placeholder="例如: umami / immich / gitea" @keydown.enter="runAiDiscover" />
          </div>
          <div v-if="aiPreview" class="form-group">
            <label>生成结果预览(确认后保存为自定义模板)</label>
            <div class="rounded-lg border border-surface-700/60 bg-surface-950/50 p-3 text-xs space-y-2">
              <p><b class="text-zinc-200">{{ aiPreview.name }}</b> <span class="ml-1 text-zinc-500">{{ aiPreview.category }}</span></p>
              <p class="text-zinc-400">{{ aiPreview.description }}</p>
              <p v-if="aiPreview.envSchema?.length" class="text-zinc-500">需要 {{ aiPreview.envSchema.length }} 个配置项:{{ aiPreview.envSchema.map((item) => item.key).join(', ') }}</p>
              <pre class="probe-output max-h-40">{{ aiPreview.defaultCompose }}</pre>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button @click="showAiModal = false" class="btn-cancel">取消</button>
          <button v-if="!aiPreview" @click="runAiDiscover" class="btn-save" :disabled="aiDiscovering || !aiQuery.trim()">{{ aiDiscovering ? '生成中…' : '生成模板' }}</button>
          <button v-else @click="useAiTemplate" class="btn-save">填入创建表单</button>
        </div>
      </div>
    </div>

    <!-- 查看模板模态框 -->
    <div v-if="viewingTemplate" class="modal-overlay" @click.self="viewingTemplate = null">
      <div class="modal-content view-modal">
        <div class="modal-header">
          <h2>{{ viewingTemplate.name }}</h2>
          <button @click="viewingTemplate = null" class="close-btn">×</button>
        </div>
        <div class="modal-body">
          <div class="template-meta">
            <span class="category-badge">{{ viewingTemplate.category }}</span>
            <span class="source-badge">{{ getSourceLabel(viewingTemplate.id) }}</span>
          </div>
          <p class="template-description">{{ viewingTemplate.description || '暂无描述' }}</p>
          <div v-if="viewingTemplate.author" class="template-author">作者: {{ viewingTemplate.author }}</div>
          <div class="compose-preview">
            <h3>Compose 配置</h3>
            <pre><code>{{ viewingTemplate.defaultCompose || viewingTemplate.compose }}</code></pre>
          </div>
        </div>
      </div>
    </div>

    <!-- 部署模板模态框 -->
    <div v-if="deployTarget" class="modal-overlay" @click.self="closeDeploy" :class="{ 'pointer-events-none': deploying }">
      <div class="modal-content deploy-modal">
        <div class="modal-header">
          <h2>部署应用: {{ deployTarget.name }}</h2>
          <button @click="closeDeploy" class="close-btn">×</button>
        </div>
        <div class="modal-body space-y-4">
          <p class="template-description">{{ deployTarget.description || '暂无描述' }}</p>
          <div class="form-group">
            <label>项目名称</label>
            <input v-model="deployProjectName" type="text" placeholder="留空使用默认名称" />
          </div>
          <div class="form-group">
            <label>部署变量</label>
            <p class="text-xs text-muted">按需填写,空值使用模板默认配置。</p>
            <div v-if="deployVariables.length" class="space-y-2 mt-2">
              <div v-for="field in deployVariables" :key="field.key" class="form-row">
                <label>{{ field.label || field.key }}</label>
                <input v-model="deployValues[field.key]" :type="field.type === 'password' ? 'password' : 'text'" :placeholder="field.default || ''" />
              </div>
            </div>
            <p v-else class="text-xs text-muted mt-2">该模板无需额外配置。</p>
          </div>
          <p v-if="deployError" class="text-xs text-rose-400">{{ deployError }}</p>
        </div>
        <div class="modal-footer">
          <button @click="closeDeploy" class="btn-cancel">取消</button>
          <button @click="deployTemplate" class="btn-save" :disabled="deploying">
            <LoaderCircle v-if="deploying" class="w-4 h-4 animate-spin" />
            {{ deploying ? '部署中…' : '部署' }}
          </button>
        </div>
      </div>
    </div>

    <ConfirmDialog
      :show="showDeleteDialog"
      title="删除自定义模板"
      message="确定删除此模板？"
      tone="danger"
      confirm-text="删除"
      @confirm="confirmDelete"
      @cancel="showDeleteDialog = false; pendingDeleteId = null"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useToastStore } from '../stores/toast.js';
import { useAgentConsole } from '../composables/useAgentConsole.js';
import { api } from '../api/client.js';
import ConfirmDialog from '../components/common/ConfirmDialog.vue';
import { Bot, LoaderCircle, Rocket } from 'lucide-vue-next';

const toast = useToastStore();
const { openAgent, updateAgentContext } = useAgentConsole();

const loading = ref(false);
const error = ref('');
const stats = ref({ totalBuiltin: 0, totalCommunity: 0, totalCustom: 0, totalFavorites: 0, categories: [] });
const filteredTemplates = ref([]);
const searchQuery = ref('');
const selectedSource = ref('all');
const selectedCategory = ref('all');
const onlyFavorites = ref(false);

const showCreateModal = ref(false);
const editingTemplate = ref(null);
const aiDiscovering = ref(false);
const showAiModal = ref(false);
const aiQuery = ref('');
const aiPreview = ref(null);
const viewingTemplate = ref(null);
const formData = ref({
  name: '',
  category: '',
  description: '',
  defaultCompose: ''
});

const showDeleteDialog = ref(false);
const pendingDeleteId = ref(null);

async function loadStats() {
  try {
    const data = await api.getMarketplaceStats();
    stats.value = data;
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

async function loadTemplates() {
  loading.value = true;
  error.value = '';
  try {
    const params = new URLSearchParams();
    if (searchQuery.value) params.set('q', searchQuery.value);
    if (selectedCategory.value !== 'all') params.set('category', selectedCategory.value);
    if (selectedSource.value !== 'all') params.set('source', selectedSource.value);
    if (onlyFavorites.value) params.set('onlyFavorites', 'true');

    const data = await api.searchMarketplaceTemplates(params);
    filteredTemplates.value = data.results || [];
  } catch (err) {
    error.value = err.message || '加载失败';
  } finally {
    loading.value = false;
  }
}

let searchTimeout = null;
function handleSearch() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => loadTemplates(), 300);
}

async function toggleFavorite(templateId) {
  try {
    const isFavorited = filteredTemplates.value.find(t => t.id === templateId)?.favorited;
    await api.toggleMarketplaceFavorite(templateId, isFavorited);
    
    await Promise.all([loadTemplates(), loadStats()]);
    toast.success(isFavorited ? '已取消收藏' : '已添加收藏');
  } catch (err) {
    toast.error(err.message || '操作失败');
  }
}

function viewTemplate(template) {
  viewingTemplate.value = template;
}

function editTemplate(template) {
  editingTemplate.value = template;
  formData.value = {
    name: template.name,
    category: template.category,
    description: template.description || '',
    defaultCompose: template.defaultCompose || ''
  };
}

async function saveTemplate() {
  if (!formData.value.name.trim()) {
    toast.error('模板名称不能为空');
    return;
  }
  if (!formData.value.defaultCompose.trim()) {
    toast.error('Compose 内容不能为空');
    return;
  }

  try {
    if (editingTemplate.value) {
      await api.updateMarketplaceTemplate(editingTemplate.value.id, formData.value);
    } else {
      await api.createMarketplaceTemplate(formData.value);
    }

    toast.success(editingTemplate.value ? '模板已更新' : '模板已创建');
    closeModal();
    await Promise.all([loadTemplates(), loadStats()]);
  } catch (err) {
    toast.error(err.message || '保存失败');
  }
}

function deleteTemplate(id) {
  pendingDeleteId.value = id;
  showDeleteDialog.value = true;
}

async function confirmDelete() {
  const id = pendingDeleteId.value;
  showDeleteDialog.value = false;

  try {
    await api.deleteMarketplaceTemplate(id);
    toast.success('模板已删除');
    await Promise.all([loadTemplates(), loadStats()]);
  } catch (err) {
    toast.error(err.message || '删除失败');
  } finally {
    pendingDeleteId.value = null;
  }
}

function openAiDiscover() {
  aiQuery.value = '';
  aiPreview.value = null;
  showAiModal.value = true;
}
/** 让 Agent 推荐 → 打开 Agent 抽屉,预填一段带模板/变量上下文的需求描述。 */
function openAgentRecommend() {
  const list = (filteredTemplates.value || []).slice(0, 30);
  const brief = list.length
    ? list.map((item) => `- ${item.id.replace(/^builtin-/i, '')}:${item.name}(${item.category || '未分类'})${(item.variables || item.envSchema)?.length ? `,变量:${(item.variables || item.envSchema).map((v) => v.key || v.label).join(',')}` : ''}`).join('\n')
    : '应用市场模板列表为空';
  updateAgentContext({
    page: '应用市场',
    mode: 'marketplace-recommend',
    summary: '请根据用户需求从应用市场模板中推荐并说明差异',
    state: JSON.stringify({ templates: brief }),
  });
  openAgent();
  window.dispatchEvent(new CustomEvent('composeops:agent-prompt', {
    detail: {
      prompt: `用户在这里想部署一个应用,请澄清或直接推荐最合适的模板。可用模板与所需变量:\n\n${brief}\n\n请先调用 app.list 确认可选应用(只读),结合用户需求给出 1-3 个推荐并说明差异;确定后可以调用 app.deploy 一键部署(需要用户确认)。`,
    },
  }));
}
async function runAiDiscover() {
  if (!aiQuery.value.trim() || aiDiscovering.value) return;
  aiDiscovering.value = true;
  try {
    const { template } = await api.discoverAiTemplate(aiQuery.value.trim());
    aiPreview.value = template;
  } catch (error) {
    useToastStore().error(error.message);
  } finally {
    aiDiscovering.value = false;
  }
}
function useAiTemplate() {
  if (!aiPreview.value) return;
  formData.value = {
    name: aiPreview.value.name || '',
    category: aiPreview.value.category || 'Custom',
    description: aiPreview.value.description || '',
    defaultCompose: aiPreview.value.defaultCompose || '',
  };
  showAiModal.value = false;
  showCreateModal.value = true;
}

function closeModal() {
  showCreateModal.value = false;
  editingTemplate.value = null;
  formData.value = { name: '', category: '', description: '', defaultCompose: '' };
}

function getSourceLabel(id) {
  if (typeof id === 'string' && id.startsWith('custom-')) return '自定义';
  if (typeof id === 'string' && id.startsWith('community-')) return '社区';
  return '内置';
}
function isCustomTemplate(template) {
  return typeof template?.id === 'string' && template.id.startsWith('custom-');
}
function isDeployableTemplate(template) {
  const id = typeof template?.id === 'string' ? template.id : '';
  return id && !id.startsWith('custom-') && !id.startsWith('community-');
}

const deployTarget = ref(null);
const deployProjectName = ref('');
const deployValues = ref({});
const deploying = ref(false);
const deployError = ref('');
const deployVariables = computed(() => {
  const template = deployTarget.value;
  if (!template) return [];
  const schema = template.envSchema || template.variables || [];
  if (Array.isArray(schema)) return schema;
  return Object.entries(schema).map(([name, config]) =>
    config && typeof config === 'object' ? { key: name, ...config } : { key: name, default: config }
  );
});

function openDeploy(template) {
  deployTarget.value = template;
  deployProjectName.value = '';
  deployValues.value = {};
  deployError.value = '';
}

function closeDeploy() {
  if (deploying.value) return;
  deployTarget.value = null;
  deployProjectName.value = '';
  deployValues.value = {};
  deployError.value = '';
}

async function deployTemplate() {
  if (!deployTarget.value || deploying.value) return;
  const template = deployTarget.value;
  deploying.value = true;
  deployError.value = '';

  const values = { ...deployValues.value };
  for (const field of deployVariables.value) {
    if ((values[field.key] === undefined || values[field.key] === '') && field.default !== undefined) {
      values[field.key] = field.default;
    }
  }
  if (deployProjectName.value.trim()) values.projectName = deployProjectName.value.trim();

  let succeeded = false;
  try {
    await api.streamBlueprintDeploy(template.id, values, (frame) => {
      if (frame.type === 'result') {
        if (frame.data?.ok) {
          succeeded = true;
          toast.success(`应用 ${template.name} 已开始部署`);
        } else if (frame.data?.message) {
          deployError.value = frame.data.message;
        }
      } else if (frame.type === 'stderr' || frame.type === 'error') {
        deployError.value = String(frame.data || '').slice(0, 500) || deployError.value;
      }
    });
    if (succeeded) {
      closeDeploy();
      await Promise.all([loadTemplates(), loadStats()]);
    }
  } catch (err) {
    deployError.value = err.message || '部署失败';
  } finally {
    deploying.value = false;
  }
}

watch(deployTarget, (template) => {
  if (!template) {
    deployValues.value = {};
    deployProjectName.value = '';
    deployError.value = '';
  }
});

onMounted(async () => {
  await Promise.all([loadStats(), loadTemplates()]);
});
</script>

<style scoped>
.marketplace-view {
  --surface-0: #05070c;
  --surface-1: #0a0d12;
  --surface-2: #0f131c;
  --surface-3: #161d2b;
  --surface-4: #1e2636;
  --accent: #38bdf8;
  --accent-muted: #6ee7b7;
  --text-primary: #e5e7eb;
  --text-secondary: #9ca3af;
  --border: #1e2636;

  min-height: 100vh;
  background: var(--surface-0);
  color: var(--text-primary);
  padding: clamp(1rem, 3vw, 2rem);
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: clamp(1.5rem, 4vw, 2rem);
}

.page-header h1 {
  font-size: clamp(1.3rem, 2.2vw, 1.5rem);
  font-weight: 600;
  letter-spacing: 0;
  margin: 0;
}

.actions {
  display: flex;
  gap: 0.75rem;
}

button {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

button:hover {
  background: var(--surface-3);
  border-color: var(--accent);
}

.btn-primary {
  background: var(--accent);
  color: var(--surface-0);
  border-color: var(--accent);
}

.btn-primary:hover {
  background: color-mix(in srgb, var(--accent) 80%, white);
}

.filter-bar {
  display: flex;
  gap: 1rem;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
}

.search-box {
  flex: 1;
  min-width: 200px;
}

.search-input {
  width: 100%;
  padding: 0.625rem 1rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-primary);
  font-size: 0.875rem;
}

.search-input:focus {
  outline: none;
  border-color: var(--accent);
}

.filters {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.filter-select {
  padding: 0.625rem 1rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-primary);
  font-size: 0.875rem;
  cursor: pointer;
}

.favorites-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  font-size: 0.875rem;
  cursor: pointer;
}

.favorites-toggle input {
  cursor: pointer;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 1rem;
  margin-bottom: 2rem;
}

.stat-card {
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 1rem;
  padding: 1.25rem;
}

.stat-card.highlight {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 5%, var(--surface-1));
}

.stat-card .label {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  margin-bottom: 0.5rem;
}

.stat-card .value {
  font-size: 1.75rem;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}

.loading-state,
.error-state {
  display: grid;
  place-items: center;
  min-height: 40vh;
  text-align: center;
}

.spinner {
  width: 3rem;
  height: 3rem;
  border: 3px solid var(--surface-3);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.templates-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1.5rem;
}

.template-card {
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 1rem;
  padding: 1.25rem;
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 1rem;
  transition: all 0.2s;
}

.template-card:hover {
  border-color: var(--accent);
  transform: translateY(-2px);
}

/* 精选模板用小徽章标注,不再整卡高亮边框(避免与收藏态混淆) */
.template-card.featured {
  border-color: var(--border);
  background: var(--surface-1);
}

.featured-badge {
  margin-left: 0.5rem;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
  font-size: 0.7rem;
  font-weight: 500;
  vertical-align: middle;
}

.card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.card-header h3 {
  font-size: 1.125rem;
  font-weight: 600;
  margin: 0;
  flex: 1;
}

.favorite-btn {
  padding: 0.25rem 0.5rem;
  font-size: 1.25rem;
  color: var(--text-secondary);
  background: transparent;
  border: none;
}

.favorite-btn.active {
  color: #f59e0b;
}

.card-body {
  display: grid;
  gap: 0.75rem;
}

.meta {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.category-badge,
.source-badge {
  display: inline-block;
  padding: 0.25rem 0.625rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 500;
}

.category-badge {
  background: var(--surface-3);
  color: var(--text-secondary);
}

.source-badge {
  background: var(--accent);
  color: var(--surface-0);
}

.description {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.5;
}

.author,
.stats-row {
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.stats-row {
  display: flex;
  gap: 1rem;
}

.card-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.btn-view,
.btn-edit,
.btn-delete,
.btn-deploy {
  flex: 1;
  min-width: fit-content;
  padding: 0.5rem 0.75rem;
  font-size: 0.8125rem;
  border-radius: 0.5rem;
}

.btn-deploy {
  background: color-mix(in srgb, var(--accent-muted) 12%, var(--surface-2));
  border-color: color-mix(in srgb, var(--accent-muted) 35%, var(--border));
  color: var(--accent-muted);
}

.btn-deploy:hover {
  background: color-mix(in srgb, var(--accent-muted) 20%, var(--surface-3));
  border-color: var(--accent-muted);
}

.btn-edit {
  background: var(--accent-muted);
  color: var(--surface-0);
  border-color: var(--accent-muted);
}

.btn-delete {
  background: #ef4444;
  color: white;
  border-color: #ef4444;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: grid;
  place-items: center;
  z-index: 1000;
  padding: 1rem;
  overflow-y: auto;
}

.modal-content {
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 1rem;
  width: 100%;
  max-width: 600px;
  max-height: 90vh;
  display: grid;
  grid-template-rows: auto 1fr auto;
}

.view-modal {
  max-width: 800px;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.5rem;
  border-bottom: 1px solid var(--border);
}

.modal-header h2 {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0;
}

.close-btn {
  padding: 0.25rem 0.5rem;
  font-size: 1.5rem;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  line-height: 1;
}

.modal-body {
  padding: 1.5rem;
  overflow-y: auto;
}

.form-group {
  display: grid;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.form-group label {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.form-group input,
.form-group textarea {
  padding: 0.625rem;
  border-radius: 0.5rem;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-primary);
  font-size: 0.875rem;
  font-family: inherit;
}

.form-group textarea {
  resize: vertical;
  font-family: 'Monaco', 'Consolas', monospace;
}

.form-row {
  display: grid;
  gap: 0.35rem;
}

.form-row label {
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.form-row input {
  padding: 0.5rem 0.625rem;
  border-radius: 0.5rem;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-primary);
  font-size: 0.875rem;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1.5rem;
  border-top: 1px solid var(--border);
}

.btn-cancel {
  background: var(--surface-2);
}

.btn-save {
  background: var(--accent);
  color: var(--surface-0);
  border-color: var(--accent);
}

.template-meta {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.template-description {
  font-size: 0.9375rem;
  line-height: 1.6;
  margin-bottom: 1rem;
}

.template-author {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin-bottom: 1.5rem;
}

.compose-preview h3 {
  font-size: 1rem;
  font-weight: 500;
  margin: 0 0 0.75rem 0;
}

.compose-preview pre {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  padding: 1rem;
  overflow-x: auto;
  margin: 0;
}

.compose-preview code {
  font-family: 'Monaco', 'Consolas', monospace;
  font-size: 0.8125rem;
  line-height: 1.5;
  color: var(--text-primary);
}
</style>
