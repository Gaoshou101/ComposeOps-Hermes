import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../api/client.js';

export const useAiStore = defineStore('ai', () => {
  const config = ref({ baseUrl: '', apiKey: '', model: '', systemPrompt: '' });
  const history = ref([]);
  const sessions = ref([]);
  const loading = ref(false);

  async function loadConfig() {
    config.value = await api.getAiConfig();
  }
  async function saveConfig(payload) {
    await api.saveAiConfig(payload);
    await loadConfig();
  }
  async function loadHistory(sessionId = null) {
    const data = await api.getAiHistory(sessionId);
    history.value = data.messages || [];
  }
  async function loadSessions() {
    const data = await api.getAiSessions(30);
    sessions.value = data.sessions || [];
  }
  async function clearHistory(sessionId = null) {
    await api.clearAiHistory(sessionId);
    history.value = [];
  }

  return { config, history, sessions, loading, loadConfig, saveConfig, loadHistory, loadSessions, clearHistory };
});
