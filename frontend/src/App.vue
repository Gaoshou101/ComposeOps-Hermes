<template>
  <div v-if="!auth.ready" class="h-dvh grid place-items-center text-surface-400">
    <div class="flex flex-col items-center gap-3">
      <span class="loading-mark"></span>
      <span class="text-sm">正在连接 ComposeOps...</span>
    </div>
  </div>
  <LoginView v-else-if="!auth.authenticated" />
  <div v-else class="h-dvh min-h-0 flex flex-col overflow-hidden">
    <AppHeader @logout="auth.logout" />
    <div class="flex min-h-0 flex-1 overflow-hidden pb-16 md:pb-0">
      <AppSidebar />
      <main class="app-main flex-1 min-w-0 overflow-auto">
        <div class="mx-auto h-full min-h-full w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-6 lg:px-8 xl:px-10 2xl:px-14">
          <router-view />
        </div>
      </main>
    </div>
    <ToastContainer />
    <CheatSheetModal :open="cheatSheet" @close="cheatSheet = false" />
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import AppHeader from './components/AppHeader.vue';
import AppSidebar from './components/AppSidebar.vue';
import ToastContainer from './components/common/ToastContainer.vue';
import CheatSheetModal from './components/common/CheatSheetModal.vue';
import LoginView from './views/LoginView.vue';
import { useAuthStore } from './stores/auth.js';
import { useServicesStore } from './stores/services.js';

const auth = useAuthStore();
const servicesStore = useServicesStore();
const cheatSheet = ref(false);
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
onMounted(() => {
  window.addEventListener('composeops:unauthorized', expire);
  window.addEventListener('composeops:host-changed', refreshOnHostChange);
  window.addEventListener('keydown', onGlobalKeydown, { capture: true });
  window.addEventListener('composeops:open-cheatsheet', openCheatSheet);
  auth.check();
});
onBeforeUnmount(() => {
  window.removeEventListener('composeops:unauthorized', expire);
  window.removeEventListener('composeops:host-changed', refreshOnHostChange);
  window.removeEventListener('keydown', onGlobalKeydown, { capture: true });
  window.removeEventListener('composeops:open-cheatsheet', openCheatSheet);
});
</script>
