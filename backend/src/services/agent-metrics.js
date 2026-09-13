/**
 * 容器资源监控工具
 * 
 * 提供实时资源使用查询、历史趋势分析、告警配置
 */

import { getActivityDocker } from './docker-hosts.js';
import { getSetting, setSetting } from '../lib/db.js';
import { scanProjects } from './scanner.js';

function readAlertRules() {
  const value = getSetting('alert_rules', '[]');
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** 只允许访问当前 Docker 节点上明确纳管的容器。 */
export async function resolveManagedContainer(containerIdOrName) {
  const needle = String(containerIdOrName || '');
  if (!needle) throw Object.assign(new Error('容器标识不能为空'), { statusCode: 400 });
  const projects = await scanProjects();
  const matches = [];
  for (const project of projects) {
    if (!project.managed) continue;
    const container = project.containers.find((item) =>
      item.id === needle || item.id.startsWith(needle) || item.name === needle
    );
    if (container) matches.push({ project, container });
  }
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw Object.assign(new Error('容器标识不唯一，请使用完整容器 ID 或名称'), { statusCode: 400 });
  throw Object.assign(new Error('容器不属于当前节点的纳管项目'), { statusCode: 403 });
}

/**
 * 查询容器资源使用情况
 * @param {string} containerIdOrName - 容器 ID 或名称
 * @param {string} metric - 指标类型 (cpu/memory/network/disk)
 * @param {string} period - 时间周期 (1m/5m/1h/1d)
 * @returns {Promise<object>}
 */
export async function queryContainerMetrics(containerIdOrName, metric = 'cpu', period = '5m') {
  const { container: managedContainer } = await resolveManagedContainer(containerIdOrName);
  const docker = await getActivityDocker();
  const container = docker.getContainer(managedContainer.id);
  
  // 获取实时统计
  const stats = await container.stats({ stream: false });
  
  // 解析统计数据
  const parsed = parseContainerStats(stats, metric);
  
  // 获取历史数据（如果启用了监控）
  const historical = await getHistoricalMetrics(managedContainer.id, metric, period);
  
  return {
    current: parsed.current,
    average: historical.avg || parsed.current,
    peak: historical.max || parsed.current,
    trend: calculateTrend(historical.data || [parsed.current]),
    unit: parsed.unit,
    timestamp: new Date().toISOString(),
    period
  };
}

/**
 * 解析容器统计数据
 */
function parseContainerStats(stats, metric) {
  switch (metric) {
    case 'cpu': {
      const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
      const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
      const cpuPercent = (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100;
      return { current: Math.round(cpuPercent * 100) / 100, unit: '%' };
    }
    
    case 'memory': {
      const used = stats.memory_stats.usage - (stats.memory_stats.stats?.cache || 0);
      const limit = stats.memory_stats.limit;
      const percent = (used / limit) * 100;
      return {
        current: Math.round(percent * 100) / 100,
        unit: '%',
        usedBytes: used,
        limitBytes: limit
      };
    }
    
    case 'network': {
      const rx = Object.values(stats.networks || {}).reduce((sum, net) => sum + net.rx_bytes, 0);
      const tx = Object.values(stats.networks || {}).reduce((sum, net) => sum + net.tx_bytes, 0);
      return {
        current: { rx: formatBytes(rx), tx: formatBytes(tx) },
        unit: 'bytes',
        rxBytes: rx,
        txBytes: tx
      };
    }
    
    case 'disk': {
      const read = stats.blkio_stats.io_service_bytes_recursive?.find(s => s.op === 'read')?.value || 0;
      const write = stats.blkio_stats.io_service_bytes_recursive?.find(s => s.op === 'write')?.value || 0;
      return {
        current: { read: formatBytes(read), write: formatBytes(write) },
        unit: 'bytes',
        readBytes: read,
        writeBytes: write
      };
    }
    
    default:
      throw new Error(`不支持的指标类型: ${metric}`);
  }
}

/**
 * 格式化字节数
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * 获取历史指标数据
 */
async function getHistoricalMetrics(containerIdOrName, metric, period) {
  const db = (await import('../lib/db.js')).default;
  const storedMetric = metric === 'network' ? 'network_rx' : metric === 'disk' ? 'disk_read' : metric;
  
  // 解析时间窗口
  const periodMs = parsePeriod(period);
  const startTime = Date.now() - periodMs;
  
  // 查询历史数据
  const rows = db.prepare(`
    SELECT value, timestamp
    FROM container_metrics
    WHERE container_id = ? AND metric_type = ? AND timestamp >= ?
    ORDER BY timestamp ASC
  `).all(containerIdOrName, storedMetric, startTime);
  
  if (rows.length === 0) {
    return { avg: null, max: null, data: [] };
  }
  
  const values = rows.map(r => r.value);
  return {
    avg: Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 100) / 100,
    max: Math.max(...values),
    data: values
  };
}

/**
 * 解析时间周期字符串为毫秒
 */
function parsePeriod(period) {
  const match = period.match(/^(\d+)(m|h|d)$/);
  if (!match) return 5 * 60 * 1000; // 默认 5 分钟
  
  const [, num, unit] = match;
  const value = parseInt(num, 10);
  
  switch (unit) {
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return 5 * 60 * 1000;
  }
}

/**
 * 计算趋势
 */
function calculateTrend(data) {
  if (data.length < 2) return 'stable';
  
  const recent = data.slice(-5);
  const avg = recent.reduce((sum, v) => sum + v, 0) / recent.length;
  const lastValue = recent[recent.length - 1];
  
  if (lastValue > avg * 1.1) return 'increasing';
  if (lastValue < avg * 0.9) return 'decreasing';
  return 'stable';
}

/**
 * 配置资源告警规则
 */
export async function configureAlert(config) {
  const { container, metric, threshold, duration = '5m', action = 'notify' } = config;
  
  // 验证容器存在
  const { container: managedContainer } = await resolveManagedContainer(container);
  const docker = await getActivityDocker();
  const containerObj = docker.getContainer(managedContainer.id);
  await containerObj.inspect(); // 抛出异常如果不存在
  
  // 创建告警规则
  const rule = {
    id: `alert_${Date.now()}`,
    container: managedContainer.id,
    metric,
    threshold,
    duration,
    action,
    enabled: true,
    createdAt: new Date().toISOString()
  };
  
  // 保存到数据库
  const existingRules = readAlertRules();
  existingRules.push(rule);
  setSetting('alert_rules', JSON.stringify(existingRules));
  
  return { ruleId: rule.id, enabled: true };
}

/**
 * 列出告警规则
 */
export async function listAlerts(containerFilter = null) {
  const rules = readAlertRules();
  const managedIds = new Set();
  for (const project of await scanProjects()) {
    if (project.managed) for (const container of project.containers) managedIds.add(container.id);
  }
  const visibleRules = rules.filter((rule) => managedIds.has(rule.container));
  
  if (containerFilter) {
    const { container } = await resolveManagedContainer(containerFilter);
    return visibleRules.filter(r => r.container === container.id);
  }
  
  return visibleRules;
}

/**
 * 删除告警规则
 */
export async function deleteAlert(ruleId) {
  const rules = readAlertRules();
  const rule = rules.find((item) => item.id === ruleId);
  if (!rule) return { deleted: 0 };
  await resolveManagedContainer(rule.container);
  const updated = rules.filter(r => r.id !== ruleId);
  setSetting('alert_rules', JSON.stringify(updated));
  return { deleted: rules.length - updated.length };
}

/**
 * 检查告警条件（由后台任务定期调用）
 */
export async function checkAlerts() {
  const rules = readAlertRules();
  const docker = await getActivityDocker();
  const managedIds = new Set();
  for (const project of await scanProjects()) {
    if (project.managed) for (const container of project.containers) managedIds.add(container.id);
  }
  const triggered = [];
  
  for (const rule of rules.filter(r => r.enabled && managedIds.has(r.container))) {
    try {
      const container = docker.getContainer(rule.container);
      const stats = await container.stats({ stream: false });
      const parsed = parseContainerStats(stats, rule.metric);
      
      const currentValue = typeof parsed.current === 'object' 
        ? parsed.current.rx || parsed.current.read // 网络/磁盘取读取值
        : parsed.current;
      
      if (currentValue > rule.threshold) {
        triggered.push({
          rule,
          currentValue,
          threshold: rule.threshold,
          container: rule.container,
          metric: rule.metric
        });
      }
    } catch (error) {
      console.error(`检查告警规则 ${rule.id} 失败:`, error.message);
    }
  }
  
  return triggered;
}
