<template>
  <div v-if="!auth.ready" class="h-dvh grid place-items-center text-surface-400">
    <div class="flex flex-col items-center gap-3">
      <span class="loading-mark"></span>
      <span class="text-sm">正在连接 ComposeOps...</span>
    </div>
  </div>
  <LoginView v-else-if="!auth.authenticated" />
  <div v-else class="h-dvh min-h-0 flex flex-col overflow-hidden">
    <AppHeader @logout="auth.logout" @open-agent="openAgent" />
    <div class="flex min-h-0 flex-1 overflow-hidden pb-16 md:pb-0">
      <AppSidebar />
      <main class="app-main flex-1 min-w-0 overflow-auto">
        <div class="mx-auto h-full min-h-full w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-6 lg:px-8 xl:px-10 2xl:px-14">
          <router-view />
        </div>
      </main>
    </div>
    <div v-if="runtimeError" class="runtime-error-bar">
      <span class="min-w-0 flex-1 truncate">{{ runtimeError }}</span>
      <button class="shrink-0 text-xs underline" @click="dismissError">忽略并继续</button>
      <button class="shrink-0 text-xs underline" @click="reloadApp">重新加载</button>
    </div>
    <ToastContainer />
    <CheatSheetModal :open="cheatSheet" @close="cheatSheet = false" />
    <AgentDrawer />
  </div>
</template>

<script setup>
import { onBeforeUnmount, onErrorCaptured, onMounted, ref } from 'vue';
import AppHeader from './components/AppHeader.vue';
import AppSidebar from './components/AppSidebar.vue';
import ToastContainer from './components/common/ToastContainer.vue';
import CheatSheetModal from './components/common/CheatSheetModal.vue';
import AgentDrawer from './components/AgentDrawer.vue';
import LoginView from './views/LoginView.vue';
import { useAuthStore } from './stores/auth.js';
import { useServicesStore } from './stores/services.js';
import { useToastStore } from './stores/toast.js';
import { useAgentConsole } from './composables/useAgentConsole.js';

const auth = useAuthStore();
const servicesStore = useServicesStore();
const toast = useToastStore();
const { openAgent, startPageTracking, stopPageTracking } = useAgentConsole();
const cheatSheet = ref(false);
const runtimeError = ref('');
// density 的读写只由 AppHeader 一处负责;这里仅在挂载时按已存偏好初始化 body 标记。
function applyDensity() {
  const value = localStorage.getItem('composeops:density') || 'comfortable';
  document.body.dataset.density = value;
  localStorage.setItem('composeops:density', value);
}
const expire = () => auth.expire();
const refreshOnHostChange = () => { void servicesStore.refresh(); };

function onGlobalKeydown(event) {
  if (event.key !== '?' || event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target;
  if (target?.tagName && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
  if (target?.isContentEditable) return;
  event.preventDefault();
  cheatSheet.value = true;
}
function openCheatSheet() { cheatSheet.value = true; }
function dismissError() { runtimeError.value = ''; }
function onRuntimeError(event) { runtimeError.value = event?.detail?.message || '发生未知运行时错误'; }
function onOperationStarted(event) { const detail = event?.detail || {}; toast.success(`已提交${detail.projectName || ''} ${ACTION_LABELS[detail.action] || detail.action} 操作,可在操作中心查看进度`); }
const ACTION_LABELS = { up: '启动', stop: '停止', restart: '重启', pull: '拉取' };
function reloadApp() { window.location.reload(); }
onErrorCaptured((error) => {
  runtimeError.value = `页面组件异常:${error?.message || error}`;
  return false; // 不阻止向上传播,但避免整页白屏
});
onMounted(() => {
  applyDensity();
  startPageTracking();
  window.addEventListener('composeops:runtime-error', onRuntimeError);
  window.addEventListener('composeops:operation-started', onOperationStarted);
  window.addEventListener('composeops:unauthorized', expire);
  window.addEventListener('composeops:host-changed', refreshOnHostChange);
  window.addEventListener('keydown', onGlobalKeydown, { capture: true });
  window.addEventListener('composeops:open-cheatsheet', openCheatSheet);
  auth.check();
});
onBeforeUnmount(() => {
  stopPageTracking();
  window.removeEventListener('composeops:runtime-error', onRuntimeError);
  window.removeEventListener('composeops:operation-started', onOperationStarted);
  window.removeEventListener('composeops:unauthorized', expire);
  window.removeEventListener('composeops:host-changed', refreshOnHostChange);
  window.removeEventListener('keydown', onGlobalKeydown, { capture: true });
  window.removeEventListener('composeops:open-cheatsheet', openCheatSheet);
});
</script>
