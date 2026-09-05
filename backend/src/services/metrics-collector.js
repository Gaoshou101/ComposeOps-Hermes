/**
 * 容器指标采集器
 * 
 * 后台定时采集容器资源指标并存储到数据库
 */

import { getActivityDocker } from './docker-hosts.js';
import db from '../lib/db.js';

/**
 * 采集所有运行中容器的指标
 */
export async function collectAllMetrics() {
  try {
    const docker = await getActivityDocker();
    const containers = await docker.listContainers({ filters: { status: ['running'] } });
    
    const collected = [];
    for (const containerInfo of containers) {
      try {
        const metrics = await collectContainerMetrics(containerInfo.Id);
        collected.push({ container: containerInfo.Id, metrics });
      } catch (error) {
        console.error(`采集容器 ${containerInfo.Id} 指标失败:`, error.message);
      }
    }
    
    return { collected: collected.length, timestamp: Date.now() };
  } catch (error) {
    console.error('采集指标失败:', error.message);
    throw error;
  }
}

/**
 * 采集单个容器的指标
 */
async function collectContainerMetrics(containerId) {
  const docker = await getActivityDocker();
  const container = docker.getContainer(containerId);
  const stats = await container.stats({ stream: false });
  
  const timestamp = Date.now();
  const metrics = [];
  
  // CPU 使用率
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
  const cpuPercent = (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100;
  
  if (!isNaN(cpuPercent) && isFinite(cpuPercent)) {
    metrics.push({
      container_id: containerId,
      metric_type: 'cpu',
      value: Math.round(cpuPercent * 100) / 100,
      unit: '%',
      timestamp
    });
  }
  
  // 内存使用率
  const memUsed = stats.memory_stats.usage - (stats.memory_stats.stats?.cache || 0);
  const memLimit = stats.memory_stats.limit;
  const memPercent = (memUsed / memLimit) * 100;
  
  if (!isNaN(memPercent) && isFinite(memPercent)) {
    metrics.push({
      container_id: containerId,
      metric_type: 'memory',
      value: Math.round(memPercent * 100) / 100,
      unit: '%',
      timestamp
    });
  }
  
  // 网络流量
  const networks = stats.networks || {};
  const rxBytes = Object.values(networks).reduce((sum, net) => sum + net.rx_bytes, 0);
  const txBytes = Object.values(networks).reduce((sum, net) => sum + net.tx_bytes, 0);
  
  metrics.push({
    container_id: containerId,
    metric_type: 'network_rx',
    value: rxBytes,
    unit: 'bytes',
    timestamp
  });
  
  metrics.push({
    container_id: containerId,
    metric_type: 'network_tx',
    value: txBytes,
    unit: 'bytes',
    timestamp
  });
  
  // 磁盘 IO
  const blkio = stats.blkio_stats.io_service_bytes_recursive || [];
  const diskRead = blkio.find(s => s.op === 'read')?.value || 0;
  const diskWrite = blkio.find(s => s.op === 'write')?.value || 0;
  
  metrics.push({
    container_id: containerId,
    metric_type: 'disk_read',
    value: diskRead,
    unit: 'bytes',
    timestamp
  });
  
  metrics.push({
    container_id: containerId,
    metric_type: 'disk_write',
    value: diskWrite,
    unit: 'bytes',
    timestamp
  });
  
  // 批量插入数据库
  const insert = db.prepare(`
    INSERT INTO container_metrics(container_id, metric_type, value, unit, timestamp)
    VALUES(?, ?, ?, ?, ?)
  `);
  
  const transaction = db.transaction(() => {
    for (const metric of metrics) {
      insert.run(
        metric.container_id,
        metric.metric_type,
        metric.value,
        metric.unit,
        metric.timestamp
      );
    }
  });
  
  transaction();
  return metrics.length;
}

/**
 * 清理过期的历史数据
 * @param {number} retentionDays - 保留天数
 */
export function pruneMetrics(retentionDays = 7) {
  const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
  const result = db.prepare('DELETE FROM container_metrics WHERE timestamp < ?').run(cutoffTime);
  return { deleted: result.changes };
}

/**
 * 启动定时采集任务
 * @param {number} intervalSeconds - 采集间隔(秒)
 */
export function startMetricsCollection(intervalSeconds = 30) {
  // 立即执行一次
  collectAllMetrics().catch(error => {
    console.error('初始指标采集失败:', error.message);
  });
  
  // 定时采集
  const intervalId = setInterval(() => {
    collectAllMetrics().catch(error => {
      console.error('定时指标采集失败:', error.message);
    });
  }, intervalSeconds * 1000);
  
  // 每小时清理一次过期数据
  const pruneIntervalId = setInterval(() => {
    pruneMetrics().catch(error => {
      console.error('清理过期指标失败:', error.message);
    });
  }, 60 * 60 * 1000);
  
  return { intervalId, pruneIntervalId };
}
