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

  async function load() {
    loading.value = true;
    error.value = '';
    try {
      const data = await api.getHosts();
      hosts.value = data.hosts || [];
      const activeItem = hosts.value.find((host) => host.active);
      activeHostId.value = activeItem?.id || 'local';
      hosts.value.forEach((host) => {
        if (host.active) host.active = true;
      });
    } catch (e) {
      error.value = e.message;
    } finally {
      loading.value = false;
    }
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
    await load();
    return result.host;
  }

  async function remove(id) {
    await api.deleteHost(id);
    if (activeHostId.value === id) activeHostId.value = 'local';
    await load();
  }

  async function switchHost(id) {
    const result = await api.setActiveHost(id);
    activeHostId.value = result.activeHostId;
    hosts.value.forEach((host) => { host.active = host.id === result.activeHostId; });
    return result;
  }

  return { hosts, activeHostId, active, loading, error, pinging, load, ping, addOrUpdate, remove, switchHost };
});
