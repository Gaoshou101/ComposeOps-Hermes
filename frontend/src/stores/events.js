import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../api/client.js';

export const useEventStore = defineStore('events', () => {
  const events = ref([]);
  const stats = ref(null);
  const loading = ref(false);
  const error = ref('');

  async function load(params = {}) {
    loading.value = true;
    error.value = '';
    try {
      const data = await api.getEvents({ limit: 200, ...params });
      events.value = data.events || [];
    } catch (e) {
      error.value = e.message;
    } finally {
      loading.value = false;
    }
  }

  async function loadStats() {
    try {
      const data = await api.getEventStats();
      stats.value = data.stats;
    } catch (e) {
      error.value = e.message;
    }
  }

  async function update(id, patch) {
    const data = await api.updateEvent(id, patch);
    const index = events.value.findIndex((e) => e.id === id);
    if (index >= 0) events.value[index] = data.event;
    await loadStats();
    return data.event;
  }

  async function prune(days = 30) {
    await api.pruneEvents(days);
    await load();
    await loadStats();
  }

  return { events, stats, loading, error, load, loadStats, update, prune };
});