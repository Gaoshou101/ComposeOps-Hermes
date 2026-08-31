import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '../api/client.js';

export const useHostsStore = defineStore('hosts', () => {
  const hosts = ref([]);
  const activeHostId = ref('local');
  const loading = ref(false);
  const error = ref('');
  const pinging = ref('');

  const active = computed(() => hosts.value.find((host) => host.id === activeHostId.value) || hosts.value[0] || null);

  async function load(force = false) {
    if (!force && hosts.value.length) {
      // 已有数据:SWR 秒开,后台静默刷新
      api.getHosts(true).then((data) => {
        hosts.value = data.hosts || [];
        syncActive(data.hosts);
      }).catch((e) => { error.value = e.message; });
      return;
    }
    loading.value = true;
    error.value = '';
    try {
      const data = await api.getHosts(force);
      hosts.value = data.hosts || [];
      syncActive(data.hosts);
    } catch (e) {
      error.value = e.message;
    } finally {
      loading.value = false;
    }
  }
  function syncActive(list) {
    const activeItem = list.find((host) => host.active);
    activeHostId.value = activeItem?.id || 'local';
    list.forEach((host) => { host.active = host.id === activeHostId.value; });
  }

  async function ping(id) {
    pinging.value = id;
    try {
      const result = await api.pingHost(id);
      const index = hosts.value.findIndex((host) => host.id === id);
      if (index >= 0 && result.host) hosts.value[index] = result.host;
      return result;
    } finally {
      pinging.value = '';
    }
  }

  async function addOrUpdate(payload) {
    const result = await api.saveHost(payload);
    await load(true);
    return result.host;
  }

  async function remove(id) {
    await api.deleteHost(id);
    if (activeHostId.value === id) activeHostId.value = 'local';
    await load(true);
  }

  async function switchHost(id) {
    const result = await api.setActiveHost(id);
    activeHostId.value = result.activeHostId;
    hosts.value.forEach((host) => { host.active = host.id === result.activeHostId; });
    return result;
  }

  return { hosts, activeHostId, active, loading, error, pinging, load, ping, addOrUpdate, remove, switchHost };
});
