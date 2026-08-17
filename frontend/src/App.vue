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
        <div class="h-full min-h-full w-full px-4 py-5 sm:px-6 sm:py-6 lg:px-8 xl:px-10 2xl:px-12">
          <router-view />
        </div>
      </main>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount } from 'vue';
import AppHeader from './components/AppHeader.vue';
import AppSidebar from './components/AppSidebar.vue';
import LoginView from './views/LoginView.vue';
import { useAuthStore } from './stores/auth.js';

const auth = useAuthStore();
const expire = () => auth.expire();
onMounted(() => {
  window.addEventListener('composeops:unauthorized', expire);
  auth.check();
});
onBeforeUnmount(() => window.removeEventListener('composeops:unauthorized', expire));
</script>
