<template>
  <div v-if="!auth.ready" class="h-screen grid place-items-center text-surface-400">正在连接 ComposeOps...</div>
  <LoginView v-else-if="!auth.authenticated" />
  <div v-else class="h-screen flex flex-col">
    <AppHeader @logout="auth.logout" />
    <div class="flex flex-1 overflow-hidden pb-14 md:pb-0">
      <AppSidebar />
      <main class="flex-1 overflow-auto p-3 md:p-5">
        <router-view />
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
