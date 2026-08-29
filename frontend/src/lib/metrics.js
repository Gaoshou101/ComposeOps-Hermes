/**
 * 容器实时指标前端工具(纯函数,便于 Vitest 单测)。
 */

/** 归一化后端推送的容器指标行。 */
export function normalizeMetricRow(row = {}) {
  return {
    containerId: row.containerId || row.id || '',
    name: row.name || '',
    cpuPercent: round(Math.max(0, Number(row.cpuPercent) || 0)),
    memUsageMB: round(Math.max(0, Number(row.memUsageMB) || Math.max(0, Number(row.memUsage) || 0) / 1024 / 1024)),
    memLimitMB: round(Math.max(0, Number(row.memLimitMB) || Math.max(0, Number(row.memLimit) || 0) / 1024 / 1024)),
    memPercent: round(Math.max(0, Number(row.memPercent) || 0)),
    netIO: row.netIO || { rxBytes: 0, txBytes: 0 },
    blockIO: row.blockIO || { readBytes: 0, writeBytes: 0 },
  };
}

/** 判定是否需要告警显示(CPU > 85% 或内存 > 90%)。 */
export function metricAlert(row, { cpuThreshold = 85, memThreshold = 90 } = {}) {
  if (!row) return false;
  return row.cpuPercent >= cpuThreshold || row.memPercent >= memThreshold;
}

/** 追加一个指标点到固定长度历史(用于 sparkline)。 */
export function pushHistory(history = [], point, max = 26) {
  const next = [...history, point];
  if (next.length > max) next.splice(0, next.length - max);
  return next;
}

/** 字节数 -> 可读字符串。 */
export function formatBytes(value = 0) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = Number(value) || 0;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}

function round(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}
