<template>
  <div class="cost-analysis-view">
    <header class="page-header">
      <h1>成本分析</h1>
      <div class="actions">
        <button @click="refreshData" :disabled="loading" class="btn-refresh">
          <span class="icon">↻</span>
          刷新
        </button>
        <button @click="recordSnapshot" :disabled="loading" class="btn-primary">
          <span class="icon">📸</span>
          记录快照
        </button>
      </div>
    </header>

    <div v-if="loading && !report" class="loading-state">
      <div class="spinner"></div>
      <p>加载成本数据...</p>
    </div>

    <div v-else-if="error" class="error-state">
      <p>{{ error }}</p>
      <button @click="refreshData" class="btn-retry">重试</button>
    </div>

    <div v-else-if="report" class="content">
      <!-- 汇总卡片 -->
      <section class="summary-grid">
        <div class="stat-card">
          <div class="label">总项目数</div>
          <div class="value">{{ report.summary.totalProjects }}</div>
        </div>
        <div class="stat-card">
          <div class="label">容器总数</div>
          <div class="value">{{ report.summary.totalContainers }}</div>
          <div class="sub">运行中: {{ report.summary.runningContainers }}</div>
        </div>
        <div class="stat-card">
          <div class="label">CPU 使用</div>
          <div class="value">{{ numberValue(report.summary.totalCPUPercent).toFixed(1) }}%</div>
        </div>
        <div class="stat-card">
          <div class="label">内存使用</div>
          <div class="value">{{ formatSize(report.summary.totalMemoryMB) }}</div>
        </div>
        <div class="stat-card">
          <div class="label">镜像占用</div>
          <div class="value">{{ formatSize(report.summary.totalImagesMB) }}</div>
        </div>
        <div class="stat-card highlight">
          <div class="label">可回收空间</div>
          <div class="value">{{ formatSize(report.summary.reclaimableMB) }}</div>
        </div>
      </section>

      <!-- 优化建议 -->
      <section v-if="suggestions.length > 0" class="suggestions-section">
        <h2>优化建议</h2>
        <div class="suggestion-list">
          <div
            v-for="(sug, idx) in suggestions"
            :key="idx"
            class="suggestion-item"
            :class="`severity-${sug.severity}`"
          >
            <div class="sug-header">
              <span class="severity-badge">{{ severityLabel(sug.severity) }}</span>
              <h3>{{ sug.title }}</h3>
            </div>
            <p class="description">{{ sug.description }}</p>
            <p class="action"><strong>建议:</strong> {{ sug.action }}</p>
          </div>
        </div>
      </section>

      <!-- 趋势图 -->
      <section v-if="report.trends.length > 1" class="trends-section">
        <h2>资源趋势 (7天)</h2>
        <div class="trend-chart">
          <svg :viewBox="`0 0 ${chartWidth} ${chartHeight}`" class="chart-svg">
            <g class="grid-lines">
              <line
                v-for="i in 5"
                :key="`h-${i}`"
                :x1="chartPadding"
                :y1="chartPadding + ((chartHeight - chartPadding * 2) / 4) * (i - 1)"
                :x2="chartWidth - chartPadding"
                :y2="chartPadding + ((chartHeight - chartPadding * 2) / 4) * (i - 1)"
                stroke="var(--surface-3)"
                stroke-width="1"
              />
            </g>
            <polyline
              :points="memoryTrendPoints"
              fill="none"
              stroke="var(--accent)"
              stroke-width="2"
            />
            <polyline
              :points="cpuTrendPoints"
              fill="none"
              stroke="var(--accent-muted)"
              stroke-width="2"
            />
          </svg>
          <div class="legend">
            <div class="legend-item">
              <span class="line" style="background: var(--accent)"></span>
              内存使用
            </div>
            <div class="legend-item">
              <span class="line" style="background: var(--accent-muted)"></span>
              CPU 使用
            </div>
          </div>
        </div>
      </section>

      <!-- 项目成本排行 -->
      <section class="projects-section">
        <h2>项目成本排行</h2>
        <div class="table-container">
          <table class="projects-table">
            <thead>
              <tr>
                <th>项目</th>
                <th>容器数</th>
                <th>运行中</th>
                <th>CPU 使用</th>
                <th>内存使用</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="proj in report.projects" :key="proj.projectId">
                <td class="project-name">{{ proj.projectName }}</td>
                <td>{{ proj.containerCount }}</td>
                <td>{{ proj.runningCount }}</td>
        <td>{{ numberValue(proj.totalCPUPercent).toFixed(1) }}%</td>
                <td>{{ formatSize(proj.totalMemoryMB) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- 大镜像列表 -->
      <section class="images-section">
        <h2>大镜像 TOP 10</h2>
        <div class="table-container">
          <table class="images-table">
            <thead>
              <tr>
                <th>镜像标签</th>
                <th>大小</th>
                <th>ID</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="img in report.images.slice(0, 10)" :key="img.id">
                <td class="image-tag">{{ img.tags[0] }}</td>
                <td>{{ formatSize(img.sizeMB) }}</td>
                <td class="image-id">{{ img.id }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- 存储分布 -->
      <section class="storage-section">
        <h2>存储分布</h2>
        <div class="storage-grid">
          <div class="storage-card">
            <h3>镜像</h3>
            <div class="stat-row">
              <span>总数</span>
              <span>{{ report.storage.images.total }}</span>
            </div>
            <div class="stat-row">
              <span>使用中</span>
              <span>{{ report.storage.images.active }}</span>
            </div>
            <div class="stat-row">
              <span>占用</span>
              <span>{{ formatSize(report.storage.images.sizeMB) }}</span>
            </div>
            <div class="stat-row highlight">
              <span>可回收</span>
              <span>{{ formatSize(report.storage.images.reclaimableMB) }}</span>
            </div>
          </div>
          <div class="storage-card">
            <h3>容器</h3>
            <div class="stat-row">
              <span>总数</span>
              <span>{{ report.storage.containers.total }}</span>
            </div>
            <div class="stat-row">
              <span>运行中</span>
              <span>{{ report.storage.containers.active }}</span>
            </div>
            <div class="stat-row">
              <span>占用</span>
              <span>{{ formatSize(report.storage.containers.sizeMB) }}</span>
            </div>
          </div>
          <div class="storage-card">
            <h3>卷</h3>
            <div class="stat-row">
              <span>总数</span>
              <span>{{ report.storage.volumes.total }}</span>
            </div>
            <div class="stat-row">
              <span>使用中</span>
              <span>{{ report.storage.volumes.active }}</span>
            </div>
            <div class="stat-row">
              <span>占用</span>
              <span>{{ formatSize(report.storage.volumes.sizeMB) }}</span>
            </div>
          </div>
          <div class="storage-card">
            <h3>构建缓存</h3>
            <div class="stat-row">
              <span>占用</span>
              <span>{{ formatSize(report.storage.buildCache.sizeMB) }}</span>
            </div>
            <div class="stat-row highlight">
              <span>可回收</span>
              <span>{{ formatSize(report.storage.buildCache.reclaimableMB) }}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from '../api/client.js';
import { useToastStore } from '../stores/toast.js';

const toast = useToastStore();

const loading = ref(false);
const error = ref('');
const report = ref(null);
const suggestions = ref([]);

const chartWidth = 800;
const chartHeight = 300;
const chartPadding = 40;

async function loadReport() {
  loading.value = true;
  error.value = '';
  try {
    const [reportData, sugData] = await Promise.all([
      api.getCostAnalysisReport(),
      api.getCostSuggestions()
    ]);
    report.value = reportData;
    suggestions.value = sugData;
  } catch (err) {
    error.value = err.message || '加载失败';
  } finally {
    loading.value = false;
  }
}

async function refreshData() {
  await loadReport();
  toast.success('数据已刷新');
}

async function recordSnapshot() {
  loading.value = true;
  try {
    await fetch('/api/v1/cost-analysis/snapshot', { method: 'POST' });
    toast.success('成本快照已记录');
    await loadReport();
  } catch (err) {
    toast.error(err.message || '记录快照失败');
  } finally {
    loading.value = false;
  }
}

function formatSize(mb) {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`;
  }
  return `${Math.round(mb)} MB`;
}
function numberValue(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; }

function severityLabel(s) {
  const map = { high: '高', medium: '中', low: '低' };
  return map[s] || s;
}

const memoryTrendPoints = computed(() => {
  if (!report.value || report.value.trends.length < 2) return '';
  const trends = report.value.trends;
  const maxMem = Math.max(...trends.map(t => numberValue(t.totalMemoryMB))) || 1;
  const stepX = (chartWidth - chartPadding * 2) / (trends.length - 1);
  return trends
    .map((t, i) => {
      const x = chartPadding + i * stepX;
      const y = chartHeight - chartPadding - ((numberValue(t.totalMemoryMB) / maxMem) * (chartHeight - chartPadding * 2));
      return `${x},${y}`;
    })
    .join(' ');
});

const cpuTrendPoints = computed(() => {
  if (!report.value || report.value.trends.length < 2) return '';
  const trends = report.value.trends;
  const maxCpu = Math.max(...trends.map(t => numberValue(t.totalCPUPercent))) || 1;
  const stepX = (chartWidth - chartPadding * 2) / (trends.length - 1);
  return trends
    .map((t, i) => {
      const x = chartPadding + i * stepX;
      const y = chartHeight - chartPadding - ((numberValue(t.totalCPUPercent) / maxCpu) * (chartHeight - chartPadding * 2));
      return `${x},${y}`;
    })
    .join(' ');
});

onMounted(() => {
  loadReport();
});
</script>

<style scoped>
.cost-analysis-view {
  --surface-0: #05070c;
  --surface-1: #0a0d12;
  --surface-2: #0f131c;
  --surface-3: #161d2b;
  --surface-4: #1e2636;
  --accent: #38bdf8;
  --accent-muted: #6ee7b7;
  --text-primary: #e5e7eb;
  --text-secondary: #9ca3af;
  --border: #1e2636;

  min-height: 100vh;
  background: var(--surface-0);
  color: var(--text-primary);
  padding: clamp(1rem, 3vw, 2rem);
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: clamp(1.5rem, 4vw, 3rem);
}

.page-header h1 {
  font-size: clamp(1.3rem, 2.2vw, 1.5rem);
  font-weight: 600;
  letter-spacing: 0;
  margin: 0;
}

.actions {
  display: flex;
  gap: 0.75rem;
}

button {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

button:hover:not(:disabled) {
  background: var(--surface-3);
  border-color: var(--accent);
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--accent);
  color: var(--surface-0);
  border-color: var(--accent);
}

.btn-primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 80%, white);
}

.loading-state,
.error-state {
  display: grid;
  place-items: center;
  min-height: 60vh;
  text-align: center;
}

.spinner {
  width: 3rem;
  height: 3rem;
  border: 3px solid var(--surface-3);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.content {
  display: grid;
  gap: clamp(1.5rem, 3vw, 2.5rem);
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 1rem;
}

.stat-card {
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 1rem;
  padding: 1.25rem;
}

.stat-card.highlight {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 5%, var(--surface-1));
}

.stat-card .label {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  margin-bottom: 0.5rem;
}

.stat-card .value {
  font-size: 1.75rem;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}

.stat-card .sub {
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin-top: 0.25rem;
}

.suggestions-section,
.trends-section,
.projects-section,
.images-section,
.storage-section {
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 1rem;
  padding: clamp(1.25rem, 3vw, 2rem);
}

section h2 {
  font-size: clamp(1.125rem, 2.5vw, 1.5rem);
  font-weight: 600;
  margin: 0 0 1.5rem 0;
  letter-spacing: -0.01em;
}

.suggestion-list {
  display: grid;
  gap: 1rem;
}

.suggestion-item {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  padding: 1rem;
}

.suggestion-item.severity-high {
  border-left: 3px solid #ef4444;
}

.suggestion-item.severity-medium {
  border-left: 3px solid #f59e0b;
}

.suggestion-item.severity-low {
  border-left: 3px solid #10b981;
}

.sug-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}

.severity-badge {
  display: inline-block;
  padding: 0.25rem 0.625rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
  background: var(--surface-3);
  color: var(--text-secondary);
}

.suggestion-item h3 {
  font-size: 0.9375rem;
  font-weight: 500;
  margin: 0;
}

.suggestion-item .description {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin: 0.5rem 0;
}

.suggestion-item .action {
  font-size: 0.875rem;
  color: var(--text-primary);
  margin: 0;
}

.trend-chart {
  margin-top: 1rem;
}

.chart-svg {
  width: 100%;
  height: auto;
  max-width: 100%;
}

.legend {
  display: flex;
  justify-content: center;
  gap: 2rem;
  margin-top: 1rem;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.legend-item .line {
  width: 1.5rem;
  height: 2px;
  border-radius: 2px;
}

.table-container {
  overflow-x: auto;
  margin-top: 1rem;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

thead {
  background: var(--surface-2);
}

th {
  padding: 0.75rem 1rem;
  text-align: left;
  font-weight: 500;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border);
}

td {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--surface-2);
}

tbody tr:hover {
  background: var(--surface-2);
}

.project-name,
.image-tag {
  font-weight: 500;
  color: var(--accent);
}

.image-id {
  font-family: 'Monaco', 'Consolas', monospace;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.storage-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
  margin-top: 1rem;
}

.storage-card {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  padding: 1rem;
}

.storage-card h3 {
  font-size: 0.9375rem;
  font-weight: 500;
  margin: 0 0 1rem 0;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0;
  font-size: 0.875rem;
  border-bottom: 1px solid var(--surface-3);
}

.stat-row:last-child {
  border-bottom: none;
}

.stat-row.highlight {
  color: var(--accent);
  font-weight: 500;
}
</style>
