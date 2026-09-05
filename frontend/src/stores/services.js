import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../api/client.js';

export const useServicesStore = defineStore('services', () => {
  const projects = ref([]);
  const loading = ref(false);
  const error = ref('');
  const lastLoadedAt = ref(0);
  const wsConnected = ref(false);
  let timer;
  let wsUnsubscribe = null;

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

  /**
   * 处理 WebSocket 容器事件,更新对应项目的容器状态
   */
  function handleContainerEvent(event) {
    if (event.type === 'snapshot') {
      // 初始快照:覆盖当前状态
      projects.value = event.data?.projects || [];
      lastLoadedAt.value = Date.now();
      return;
    }
    
    if (event.type === 'container_event') {
      const { projectId, action } = event;
      const project = projects.value.find((p) => p.id === projectId);
      if (!project) return;

      // 容器状态变化:立即刷新该项目(乐观更新)
      void api.getProjects(true).then((data) => {
        const updated = data.projects?.find((p) => p.id === projectId);
        if (updated) {
          const idx = projects.value.findIndex((p) => p.id === projectId);
          if (idx !== -1) projects.value[idx] = updated;
        }
      });
    }
  }

  /**
   * 启动 WebSocket 实时订阅(优先);失败时降级到轮询
   */
  function startWebSocket(onSocketReady) {
    if (wsUnsubscribe) return; // 已连接
    
    if (typeof onSocketReady === 'function') {
      wsUnsubscribe = onSocketReady({
        onMessage: (event) => {
          wsConnected.value = true;
          handleContainerEvent(event);
        },
        onOpen: () => {
          wsConnected.value = true;
          error.value = '';
        },
        onClose: () => {
          wsConnected.value = false;
        },
        onError: () => {
          wsConnected.value = false;
          // WebSocket 失败时降级到轮询
          if (!timer) startAutoRefresh(5000);
        },
      });
    }
  }

  function stopWebSocket() {
    if (wsUnsubscribe) {
      wsUnsubscribe();
      wsUnsubscribe = null;
    }
    wsConnected.value = false;
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

  return { 
    projects, 
    loading, 
    error, 
    lastLoadedAt, 
    wsConnected,
    refresh, 
    startAutoRefresh, 
    stopAutoRefresh,
    startWebSocket,
    stopWebSocket,
  };
});
