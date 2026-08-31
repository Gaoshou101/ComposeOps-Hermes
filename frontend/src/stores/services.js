import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../api/client.js';

export const useServicesStore = defineStore('services', () => {
  const projects = ref([]);
  const loading = ref(false);
  const error = ref('');
  const lastLoadedAt = ref(0);
  let timer;

  /**
   * SWR 语义刷新:
   * - 已有数据时静默拉新(不置 loading,避免切页回来白屏/高度跳动);
   * - 首次加载(无数据)才显示 loading。
   */
  async function refresh(force = false) {
    const hasData = projects.value.length > 0;
    if (!hasData) loading.value = true;
    error.value = '';
    try {
      const data = await api.getProjects(force);
      projects.value = data.projects || [];
      lastLoadedAt.value = Date.now();
    } catch (e) {
      error.value = e.message;
    } finally {
      loading.value = false;
    }
  }

  function startAutoRefresh(intervalMs = 5000) {
    if (timer) return;
    void refresh(false);
    timer = setInterval(() => void refresh(false), intervalMs);
  }
  function stopAutoRefresh() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { projects, loading, error, lastLoadedAt, refresh, startAutoRefresh, stopAutoRefresh };
});
