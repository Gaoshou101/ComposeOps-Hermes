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
      // 后端返回 { owners:[...], groupedByOwner:{owner:[projects]} };
      // 前端模板按 [{owner, projects}] 数组遍历，这里做一次归一。
      if (data?.groupedByOwner) {
        const order = data.owners || Object.keys(data.groupedByOwner);
        groups.value = order
          .filter((o) => data.groupedByOwner[o]?.length)
          .map((o) => ({ owner: o, projects: data.groupedByOwner[o] }));
      } else if (Array.isArray(data?.groups)) {
        groups.value = data.groups;
      } else {
        groups.value = [];
      }
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
