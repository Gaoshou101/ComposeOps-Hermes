<template>
  <div class="h-full flex flex-col bg-[#05070C]">
    <!-- GITOPS_HEADER_MARKER -->
    <header class="flex-none border-b border-[#1E2636] bg-[#0A0D12] px-6 py-4">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 class="text-xl font-semibold text-slate-100">GitOps 集成</h1>
          <p class="mt-1 text-sm text-slate-400">同步 Git 仓库，按提交查看代码版本</p>
        </div>
        <button
          @click="openAddModal"
          class="flex h-10 items-center gap-2 rounded-full bg-[#38BDF8] px-5 text-sm font-medium text-slate-950 transition hover:bg-[#38BDF8]/90"
        >
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          添加仓库
        </button>
      </div>
    </header>

    <!-- Repository List -->
    <main class="flex-1 overflow-auto px-6 py-6">
      <div v-if="loading" class="flex items-center justify-center py-12">
        <div class="h-8 w-8 animate-spin rounded-full border-2 border-[#38BDF8] border-t-transparent"></div>
      </div>

      <div v-else-if="repos.length === 0" class="flex flex-col items-center justify-center py-16 text-center">
        <svg class="mb-4 h-16 w-16 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        <p class="text-lg text-slate-300">暂无 GitOps 仓库</p>
        <p class="mt-2 text-sm text-slate-500">添加第一个仓库开始同步代码</p>
      </div>

      <div v-else class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <article
          v-for="repo in repos"
          :key="repo.id"
          class="flex flex-col gap-4 rounded-3xl border border-[#1E2636] bg-[#0F131C] p-5 transition hover:border-[#38BDF8]/20"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <h3 class="truncate text-base font-medium text-slate-100">{{ repo.name }}</h3>
              <p class="mt-1 truncate text-sm text-slate-400">{{ repo.url }}</p>
            </div>
            <span :class="['flex-none text-xs font-medium', getStatusColor(repo.status)]">
              {{ getStatusLabel(repo.status) }}
            </span>
          </div>

          <div class="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p class="text-slate-500">分支</p>
              <p class="mt-1 font-medium text-slate-300">{{ repo.branch || 'main' }}</p>
            </div>
            <div>
              <p class="text-slate-500">自动同步</p>
              <p class="mt-1 font-medium text-slate-300">{{ repo.autoSync ? '开启' : '关闭' }}</p>
            </div>
          </div>

          <div v-if="repo.lastSync" class="text-xs text-slate-500">
            最后同步：{{ new Date(repo.lastSync).toLocaleString('zh-CN') }}
          </div>

          <div class="flex flex-wrap gap-2 border-t border-[#1E2636] pt-4">
            <button
              @click="syncRepo(repo.id)"
              class="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full border border-[#38BDF8]/30 bg-[#38BDF8]/10 text-xs font-medium text-[#38BDF8] transition hover:bg-[#38BDF8]/20"
            >
              <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              同步
            </button>
            <button
              @click="loadHistory(repo.id)"
              class="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full border border-[#1E2636] bg-[#0A0D12] text-xs font-medium text-slate-300 transition hover:border-[#38BDF8]/30"
            >
              <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              历史
            </button>
            <button
              @click="openEditModal(repo)"
              class="flex h-8 items-center justify-center rounded-full border border-[#1E2636] bg-[#0A0D12] px-3 text-xs font-medium text-slate-300 transition hover:border-[#38BDF8]/30"
            >
              编辑
            </button>
            <button
              @click="deleteRepo(repo.id)"
              class="flex h-8 items-center justify-center rounded-full border border-rose-500/30 bg-rose-500/10 px-3 text-xs font-medium text-rose-400 transition hover:bg-rose-500/20"
            >
              删除
            </button>
          </div>
        </article>
      </div>
    </main>

    <!-- Add/Edit Modal -->
    <div
      v-if="showAddModal || showEditModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      @click.self="showAddModal = showEditModal = false"
    >
      <div class="w-full max-w-lg rounded-3xl border border-[#1E2636] bg-[#0F131C] p-6 shadow-2xl">
        <h2 class="text-lg font-semibold text-slate-100">{{ showAddModal ? '添加仓库' : '编辑仓库' }}</h2>
        
        <form @submit.prevent="showAddModal ? addRepo() : updateRepo()" class="mt-6 space-y-4">
          <div>
            <label class="block text-sm font-medium text-slate-300">仓库名称</label>
            <input
              v-model="formData.name"
              required
              maxlength="200"
              class="mt-1.5 w-full rounded-full border border-[#1E2636] bg-[#0A0D12] px-4 py-2 text-sm text-slate-100 placeholder-slate-500 transition focus:border-[#38BDF8] focus:outline-none focus:ring-1 focus:ring-[#38BDF8]"
              placeholder="例：my-app"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-slate-300">Git URL</label>
            <input
              v-model="formData.url"
              required
              maxlength="500"
              class="mt-1.5 w-full rounded-full border border-[#1E2636] bg-[#0A0D12] px-4 py-2 text-sm text-slate-100 placeholder-slate-500 transition focus:border-[#38BDF8] focus:outline-none focus:ring-1 focus:ring-[#38BDF8]"
              placeholder="git@github.com:user/repo.git"
            />
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-slate-300">分支</label>
              <input
                v-model="formData.branch"
                maxlength="100"
                class="mt-1.5 w-full rounded-full border border-[#1E2636] bg-[#0A0D12] px-4 py-2 text-sm text-slate-100 placeholder-slate-500 transition focus:border-[#38BDF8] focus:outline-none focus:ring-1 focus:ring-[#38BDF8]"
                placeholder="main"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-300">关联项目</label>
              <select
                v-model="formData.projectId"
                required
                class="mt-1.5 w-full rounded-full border border-[#1E2636] bg-[#0A0D12] px-4 py-2 text-sm text-slate-100 transition focus:border-[#38BDF8] focus:outline-none focus:ring-1 focus:ring-[#38BDF8]"
              >
                <option value="">选择项目</option>
                <option v-for="proj in projects" :key="proj.id" :value="proj.id">{{ proj.name }}</option>
              </select>
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-slate-300">本地路径</label>
            <input
              v-model="formData.localPath"
              required
              maxlength="500"
              class="mt-1.5 w-full rounded-full border border-[#1E2636] bg-[#0A0D12] px-4 py-2 text-sm text-slate-100 placeholder-slate-500 transition focus:border-[#38BDF8] focus:outline-none focus:ring-1 focus:ring-[#38BDF8]"
              placeholder="/path/to/local/repo"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-slate-300">SSH 私钥（可选）</label>
            <textarea
              v-model="formData.sshKey"
              rows="4"
              maxlength="10000"
              class="mt-1.5 w-full rounded-2xl border border-[#1E2636] bg-[#0A0D12] px-4 py-2 text-sm text-slate-100 placeholder-slate-500 transition focus:border-[#38BDF8] focus:outline-none focus:ring-1 focus:ring-[#38BDF8]"
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            ></textarea>
          </div>

          <div class="flex items-center gap-3">
            <input
              v-model="formData.autoSync"
              type="checkbox"
              id="autoSync"
              class="h-4 w-4 rounded border-[#1E2636] bg-[#0A0D12] text-[#38BDF8] transition focus:ring-2 focus:ring-[#38BDF8] focus:ring-offset-2 focus:ring-offset-[#0F131C]"
            />
            <label for="autoSync" class="text-sm font-medium text-slate-300">启用自动同步</label>
          </div>

          <div class="flex gap-3 pt-2">
            <button
              type="button"
              @click="showAddModal = showEditModal = false"
              class="flex-1 rounded-full border border-[#1E2636] bg-[#0A0D12] px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:border-[#38BDF8]/30"
            >
              取消
            </button>
            <button
              type="submit"
              class="flex-1 rounded-full bg-[#38BDF8] px-4 py-2.5 text-sm font-medium text-slate-950 transition hover:bg-[#38BDF8]/90"
            >
              {{ showAddModal ? '添加' : '保存' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- History Modal -->
    <div
      v-if="showHistoryModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      @click.self="showHistoryModal = false"
    >
      <div class="flex h-[80vh] w-full max-w-2xl flex-col rounded-3xl border border-[#1E2636] bg-[#0F131C] shadow-2xl">
        <header class="flex-none border-b border-[#1E2636] p-6">
          <h2 class="text-lg font-semibold text-slate-100">提交历史</h2>
          <p class="mt-1 text-sm text-slate-400">{{ currentRepo?.name }}</p>
        </header>

        <div class="flex-1 overflow-auto p-6">
          <div v-if="commitHistory.length === 0" class="flex flex-col items-center justify-center py-12 text-center">
            <p class="text-slate-400">暂无提交历史</p>
          </div>

          <div v-else class="space-y-3">
            <article
              v-for="commit in commitHistory"
              :key="commit.hash"
              class="flex items-start gap-4 rounded-2xl border border-[#1E2636] bg-[#0A0D12] p-4"
            >
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <code class="rounded bg-[#1E2636] px-2 py-0.5 text-xs font-mono text-[#38BDF8]">
                    {{ commit.hash.substring(0, 7) }}
                  </code>
                  <span class="text-xs text-slate-500">{{ commit.date }}</span>
                </div>
                <p class="mt-2 text-sm text-slate-300">{{ commit.message }}</p>
                <p class="mt-1 text-xs text-slate-500">{{ commit.author }}</p>
              </div>
              <button
                v-if="commit.hash !== currentRepo?.lastCommit"
                @click="rollback(commit.hash)"
                class="flex-none rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-400 transition hover:bg-amber-500/20"
              >
                回滚
              </button>
              <span
                v-else
                class="flex-none rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400"
              >
                当前
              </span>
            </article>
          </div>
        </div>

        <footer class="flex-none border-t border-[#1E2636] p-6">
          <button
            @click="showHistoryModal = false"
            class="w-full rounded-full border border-[#1E2636] bg-[#0A0D12] px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:border-[#38BDF8]/30"
          >
            关闭
          </button>
        </footer>
      </div>
    </div>
    <ConfirmDialog :show="!!deleteTarget" title="删除 GitOps 仓库" message="确认移除此 GitOps 配置?不会删除本地仓库文件。" tone="danger" confirm-text="删除仓库" @confirm="confirmDelete" @cancel="deleteTarget = null" />
    <ConfirmDialog :show="!!rollbackTarget" title="回滚 GitOps 仓库" :message="`确认回滚到提交 ${rollbackTarget?.slice(0, 7) || ''}?仓库工作区会重置到该版本。`" tone="warning" confirm-text="确认回滚" @confirm="confirmRollback" @cancel="rollbackTarget = null" />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useToastStore } from '../stores/toast.js';
import ConfirmDialog from '../components/common/ConfirmDialog.vue';

const toast = useToastStore();

function showNotification(type, title, message) {
  const text = message ? `${title}: ${message}` : title;
  toast[type](text);
}

const repos = ref([]);
const loading = ref(false);
const showAddModal = ref(false);
const showEditModal = ref(false);
const showHistoryModal = ref(false);
const currentRepo = ref(null);
const commitHistory = ref([]);
const deleteTarget = ref(null);
const rollbackTarget = ref(null);

const formData = ref({
  name: '',
  url: '',
  branch: 'main',
  localPath: '',
  projectId: '',
  autoSync: false,
  sshKey: '',
});

const projects = ref([]);

async function loadProjects() {
  try {
    const res = await fetch('/api/v1/projects');
    if (!res.ok) throw new Error('Failed to load projects');
    const data = await res.json();
    projects.value = data.projects || [];
  } catch (err) {
    showNotification('error', '加载项目列表失败', err.message);
  }
}

async function loadRepos() {
  loading.value = true;
  try {
    const res = await fetch('/api/v1/gitops');
    if (!res.ok) throw new Error('Failed to load repositories');
    const data = await res.json();
    repos.value = data.repositories || [];
  } catch (err) {
    showNotification('error', '加载仓库列表失败', err.message);
  } finally {
    loading.value = false;
  }
}

function openAddModal() {
  formData.value = {
    name: '',
    url: '',
    branch: 'main',
    localPath: '',
    projectId: '',
    autoSync: false,
    sshKey: '',
  };
  showAddModal.value = true;
}

function openEditModal(repo) {
  currentRepo.value = repo;
  formData.value = { ...repo };
  showEditModal.value = true;
}

async function addRepo() {
  try {
    const res = await fetch('/api/v1/gitops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData.value),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || 'Failed to add repository');
    }
    showNotification('success', '仓库添加成功');
    showAddModal.value = false;
    await loadRepos();
  } catch (err) {
    showNotification('error', '添加仓库失败', err.message);
  }
}

async function updateRepo() {
  try {
    const res = await fetch(`/api/v1/gitops/${currentRepo.value.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData.value),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || 'Failed to update repository');
    }
    showNotification('success', '仓库更新成功');
    showEditModal.value = false;
    await loadRepos();
  } catch (err) {
    showNotification('error', '更新仓库失败', err.message);
  }
}

async function deleteRepo(id) {
  deleteTarget.value = id;
}
async function confirmDelete() {
  const id = deleteTarget.value;
  deleteTarget.value = null;
  if (!id) return;
  try {
    const res = await fetch(`/api/v1/gitops/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || 'Failed to delete repository');
    }
    showNotification('success', '仓库删除成功');
    await loadRepos();
  } catch (err) {
    showNotification('error', '删除仓库失败', err.message);
  }
}

async function syncRepo(id) {
  try {
    const res = await fetch(`/api/v1/gitops/${id}/sync`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || 'Failed to sync repository');
    }
    const data = await res.json();
    showNotification('success', data.hasChanges ? '同步成功，发现新提交' : '同步成功，无新提交');
    await loadRepos();
  } catch (err) {
    showNotification('error', '同步失败', err.message);
  }
}

async function loadHistory(id) {
  currentRepo.value = repos.value.find(r => r.id === id);
  try {
    const res = await fetch(`/api/v1/gitops/${id}/history?limit=50`);
    if (!res.ok) throw new Error('Failed to load history');
    const data = await res.json();
    commitHistory.value = data.commits || [];
    showHistoryModal.value = true;
  } catch (err) {
    showNotification('error', '加载历史失败', err.message);
  }
}

async function rollback(commitHash) {
  rollbackTarget.value = commitHash;
}
async function confirmRollback() {
  const commitHash = rollbackTarget.value;
  rollbackTarget.value = null;
  if (!commitHash || !currentRepo.value) return;
  try {
    const res = await fetch(`/api/v1/gitops/${currentRepo.value.id}/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commitHash }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || 'Failed to rollback');
    }
    showNotification('success', '回滚成功');
    showHistoryModal.value = false;
    await loadRepos();
  } catch (err) {
    showNotification('error', '回滚失败', err.message);
  }
}

function getStatusColor(status) {
  const colors = {
    synced: 'text-emerald-400',
    pending: 'text-amber-400',
    error: 'text-rose-400',
  };
  return colors[status] || 'text-slate-400';
}

function getStatusLabel(status) {
  const labels = {
    synced: '已同步',
    pending: '待同步',
    error: '错误',
  };
  return labels[status] || '未知';
}

onMounted(() => {
  loadProjects();
  loadRepos();
});
</script>

<style scoped>
input[type="checkbox"]:checked {
  background-image: url("data:image/svg+xml,%3csvg viewBox='0 0 16 16' fill='white' xmlns='http://www.w3.org/2000/svg'%3e%3cpath d='M12.207 4.793a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0l-2-2a1 1 0 011.414-1.414L6.5 9.086l4.293-4.293a1 1 0 011.414 0z'/%3e%3c/svg%3e");
}
</style>
