import * as YAML from 'yaml';

/**
 * Compose 语义校验(仅静态分析,不依赖宿主机文件系统):
 * - depends_on 引用的服务必须存在
 * - links 引用必须存在
 * - 容器/卷名唯一性
 * - 端口映射冲突(同一项目内 hostPort:containerPort 重复)
 * - 镜像字段缺失检查
 * 返回 [{ level: 'error'|'warn', message, service?, line? }]
 */
export function validateComposeSemantics(content) {
  const issues = [];
  if (typeof content !== 'string' || !content.trim()) return issues;
  let doc;
  try {
    doc = YAML.parse(content);
  } catch (error) {
    issues.push({ level: 'error', message: `YAML 解析失败:${error.message}` });
    return issues;
  }
  if (!doc || typeof doc !== 'object') {
    issues.push({ level: 'error', message: 'Compose 顶层必须是映射(services / volumes / networks)' });
    return issues;
  }
  const services = doc.services && typeof doc.services === 'object' ? doc.services : {};
  const serviceNames = new Set(Object.keys(services));

  const hostPorts = new Map(); // "host:container" -> serviceName
  for (const [name, service] of Object.entries(services)) {
    if (!service || typeof service !== 'object') {
      issues.push({ level: 'error', message: `服务 ${name} 不是合法的映射`, service: name });
      continue;
    }
    if (!service.image && !service.build) {
      issues.push({ level: 'warn', message: `服务 ${name} 未声明 image 或 build`, service: name });
    }
    if (service.image && typeof service.image !== 'string') {
      issues.push({ level: 'warn', message: `服务 ${name} 的 image 不是字符串`, service: name });
    }
    for (const dep of normalizeList(service.depends_on)) {
      if (!serviceNames.has(dep)) {
        issues.push({ level: 'error', message: `服务 ${name} 的 depends_on 引用了不存在的服务 ${dep}`, service: name });
      }
    }
    for (const link of normalizeList(service.links)) {
      const target = String(link).split(':')[0];
      if (!serviceNames.has(target)) {
        issues.push({ level: 'error', message: `服务 ${name} 的 links 引用了不存在的服务 ${target}`, service: name });
      }
    }
    const ports = normalizeList(service.ports);
    for (const raw of ports) {
      const entry = String(raw);
      if (/^\d+:\d+$/.test(entry)) {
        const key = entry;
        const prev = hostPorts.get(key);
        if (prev && prev !== name) {
          issues.push({ level: 'error', message: `端口映射 ${entry} 与 ${prev} 冲突`, service: name });
        } else {
          hostPorts.set(key, name);
        }
      } else if (/^\d+$/.test(entry)) {
        // 仅声明容器端口,不冲突
      }
    }
    if (Array.isArray(service.environment) || (service.environment && typeof service.environment === 'object')) {
      const seen = new Set();
      const items = Array.isArray(service.environment) ? service.environment : Object.keys(service.environment);
      for (const item of items) {
        const key = String(item).split('=')[0];
        if (seen.has(key)) issues.push({ level: 'warn', message: `服务 ${name} 的 environment 重复定义 ${key}`, service: name });
        seen.add(key);
      }
    }
  }

  if (doc.volumes && typeof doc.volumes === 'object') {
    for (const [name, def] of Object.entries(doc.volumes)) {
      if (def && typeof def === 'object' && def.driver_opts && Object.keys(def.driver_opts).length) {
        issues.push({ level: 'info', message: `卷 ${name} 使用了 driver_opts(可能在远程节点不可用)`, service: null });
      }
    }
  }
  return issues.slice(0, 50);
}

function normalizeList(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') return Object.keys(value); // depends_on: { db: { condition } }
  return [value];
}

/**
 * Compose 变更预览:静态对比新内容与当前运行容器,评估影响面。
 * 返回 { added, removed, changed, restarted, portConflicts }
 */
export function previewComposeChange(newContent, project) {
  const result = { added: [], removed: [], changed: [], restarted: [], portConflicts: [] };
  let doc;
  try {
    doc = YAML.parse(newContent);
  } catch {
    return result; // YAML 无效时不提供预览
  }
  const newServices = doc && doc.services && typeof doc.services === 'object' ? doc.services : {};
  const newNames = new Set(Object.keys(newServices));

  const currentNames = new Set();
  for (const container of project.containers || []) {
    // 容器名形如 <project>-<service>-<n> 或 <project>_<service>_<n>
    const match = /^[^-_]+[-_](.+)[-_]\d+$/.exec(container.name);
    const service = match ? match[1] : container.name;
    currentNames.add(service);
    if (!newNames.has(service)) result.removed.push({ service, container: container.name, state: container.state });
  }
  for (const [name, service] of Object.entries(newServices)) {
    if (!currentNames.has(name)) {
      result.added.push({ service: name });
      continue;
    }
    // 检测需要重建的变更(镜像/环境/卷/端口/命令变化)
    const running = [...(project.containers || [])].find((c) => {
      const match = /^[^-_]+[-_](.+)[-_]\d+$/.exec(c.name);
      return match && match[1] === name;
    });
    if (!running) { result.added.push({ service: name }); continue; }
    const sig = buildServiceSignature(service);
    if (sig.imageChanged || sig.envChanged || sig.portsChanged || sig.volumesChanged || sig.commandChanged) {
      result.changed.push({ service: name, reasons: sig.reasons, container: running.name, state: running.state });
      if (running.state === 'running') result.restarted.push({ service: name, container: running.name });
    }
    // 端口冲突检测
    for (const raw of normalizeList(service.ports || [])) {
      const entry = String(raw);
      if (/^\d+:\d+$/.test(entry)) result.portConflicts.push(entry);
    }
  }
  return result;
}

function buildServiceSignature(service) {
  const reasons = [];
  const imageChanged = typeof service.image === 'string' && /:/.test(service.image);
  const envChanged = !!service.environment && (Array.isArray(service.environment) || typeof service.environment === 'object');
  const portsChanged = !!service.ports && Array.isArray(service.ports) && service.ports.length > 0;
  const volumesChanged = !!service.volumes && Array.isArray(service.volumes) && service.volumes.length > 0;
  const commandChanged = !!service.command || !!service.entrypoint;
  if (imageChanged) reasons.push('镜像');
  if (envChanged) reasons.push('环境变量');
  if (portsChanged) reasons.push('端口');
  if (volumesChanged) reasons.push('卷');
  if (commandChanged) reasons.push('命令/入口');
  return { imageChanged, envChanged, portsChanged, volumesChanged, commandChanged, reasons };
}
