/**
 * WebUI 端口智能雷达:从项目容器端口映射中提取可直接访问的 Web 端口。
 * 纯函数,便于单测;运行时不依赖任何宿主命令。
 */

// 明确属于数据面、不作为 WebUI 的端口(聚类识别时优先排除)。
const DATA_PORTS = new Set([22, 3306, 5432, 6379, 27017, 11211, 9200, 9300, 1883, 25, 110, 143, 587, 993, 995]);

// WebUI 典型端口按优先级排序:80/443 最优先,依次 3000/8000/8080/9000 等。
const WEBUI_PORTS = [80, 443, 3000, 8080, 8000, 8888, 9000, 8081, 5000, 5173, 3001, 8096, 8123, 9090, 7474, 15672, 6080];

const WEBUI_RANGE = { min: 1024, max: 65535 };

/** 过滤出 Web 候选端口,并整体判定容器是否像数据库。 */
export function classifyPorts(container = {}) {
  const ports = (container.ports || []).filter((port) => Number(port.public) > 0);
  const candidates = ports
    .map((port) => Number(port.public))
    .filter((port) => !DATA_PORTS.has(port));
  // 容器镜像名包含数据库关键字时,即使挂了管理端口也不暴露为 WebUI 直达。
  const image = String(container.image || '').toLowerCase();
  const isDatabase = /(postgres|mysql|mariadb|redis|mongo|clickhouse|couchdb|elasticsearch|influxdb|influx)/.test(image);
  return { candidates, isDatabase };
}

/** 从候选端口中挑选 WebUI 端口:优先典型端口,其次回落 1024+ 的最小端口。 */
export function pickWebPorts(candidates = []) {
  const uniq = [...new Set(candidates.map((port) => Number(port)).filter((port) => port > 0))];
  if (!uniq.length) return [];
  const themed = uniq.filter((port) => WEBUI_PORTS.includes(port)).sort((a, b) => WEBUI_PORTS.indexOf(a) - WEBUI_PORTS.indexOf(b));
  if (themed.length) return themed;
  const ranged = uniq.filter((port) => port >= WEBUI_RANGE.min && port <= WEBUI_RANGE.max).sort((a, b) => a - b);
  return ranged.length ? ranged : uniq.sort((a, b) => a - b);
}

/**
 * 项目级 WebUI 端口汇总:遍历运行中容器,聚合所有 Web 候选端口。
 * 返回 [{ container, ports: [port...] }],按典型端口排序。
 */
export function scanProjectWebPorts(project = {}) {
  const containers = (project.containers || []).filter((container) => container.state === 'running');
  const results = [];
  for (const container of containers) {
    const { candidates, isDatabase } = classifyPorts(container);
    if (isDatabase) continue;
    const ports = pickWebPorts(candidates);
    if (!ports.length) continue;
    results.push({ containerId: container.id, containerName: container.name, ports });
  }
  return results;
}

/**
 * 生成直达链接主机名:优先使用传入的 host(常为前端访问 Host),否则 localhost。
 * 仅保留 http/https 前缀,避免注入。
 */
export function buildWebUiLinks(hostHeader = '', entries = []) {
  const host = String(hostHeader || '').trim().replace(/^https?:\/\//i, '').replace(/[/?#].*$/, '').split(':')[0];
  const safeHost = host && !/[\s\/\\]/.test(host) ? host : 'localhost';
  return entries.map((entry) => ({
    containerId: entry.containerId,
    containerName: entry.containerName,
    ports: entry.ports.map((port) => ({ port, url: `http://${safeHost}:${port}` })),
  }));
}
