<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <div><h1 class="page-title">操作记录</h1><p class="page-subtitle">Compose 操作、配置保存和维护任务</p></div>
      <button class="btn-secondary" @click="load"><RefreshCw class="w-4 h-4" />刷新</button>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>时间</th><th>项目</th><th>操作</th><th>结果</th><th>详情</th></tr></thead>
        <tbody>
          <tr v-for="item in operations" :key="item.id">
            <td class="whitespace-nowrap">{{ formatTime(item.createdAt) }}</td>
            <td>{{ item.projectName || '系统' }}</td><td class="font-mono">{{ item.action }}</td>
            <td><StatusBadge :status="item.status === 'success' ? 'running' : 'partial'" /></td>
            <td><button v-if="item.detail" class="icon-btn" title="查看输出" @click="selected = item"><Eye class="w-4 h-4" /></button></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="selected" class="modal-backdrop" @click.self="selected = null">
      <div class="modal"><div class="modal-header"><span>{{ selected.action }}</span><button class="icon-btn" @click="selected = null"><X class="w-4 h-4" /></button></div><pre class="terminal-output">{{ selected.detail }}</pre></div>
    </div>
  </div>
</template>
<script setup>
import { onMounted, ref } from 'vue';
import { Eye, RefreshCw, X } from 'lucide-vue-next';
import { api } from '../api/client.js';
import StatusBadge from '../components/StatusBadge.vue';
const operations = ref([]); const selected = ref(null);
async function load() { operations.value = (await api.getOperations()).operations || []; }
function formatTime(value) { return value ? new Date(`${value}Z`).toLocaleString() : ''; }
onMounted(load);
</script>
