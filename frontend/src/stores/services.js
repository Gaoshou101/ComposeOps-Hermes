import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../api/client.js';

export const useServicesStore = defineStore('services', () => {
  const groups = ref([]);
  const loading = ref(false);
  const error = ref('');
  let timer;

  async function refresh() {
    loading.value = true;
    error.value = '';
    try {
      const data = await api.getServices();
      groups.value = data.groups || data || [];
    } catch (e) {
      error.value = e.message;
    } finally {
      loading.value = false;
    }
  }

  function startAutoRefresh(intervalMs = 5000) {
    if (timer) return;
    refresh();
    timer = setInterval(refresh, intervalMs);
  }
  function stopAutoRefresh() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { groups, loading, error, refresh, startAutoRefresh, stopAutoRefresh };
});
