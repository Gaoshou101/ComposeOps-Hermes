import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../api/client.js';

export const useAiStore = defineStore('ai', () => {
  const config = ref({ baseUrl: '', apiKey: '', model: '', systemPrompt: '' });
  const history = ref([]);
  const loading = ref(false);

  async function loadConfig() {
    config.value = await api.getAiConfig();
  }
  async function saveConfig(payload) {
    await api.saveAiConfig(payload);
    await loadConfig();
  }
  async function loadHistory() {
    const data = await api.getAiHistory();
    history.value = data.messages || [];
  }
  async function clearHistory() {
    await api.clearAiHistory();
    history.value = [];
  }

  return { config, history, loading, loadConfig, saveConfig, loadHistory, clearHistory };
});
