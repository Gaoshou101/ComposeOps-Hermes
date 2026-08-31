// 统一 API 客户端,基于 fetch 封装
const BASE = '/api/v1';

/**
 * SWR(Stale-While-Revalidate)内存缓存:
 * - GET 命中有效缓存时立即返回旧数据(0ms 秒开),后台静默拉取最新数据;
 * - 默认 TTL 12s;write 请求(POST/PUT/DELETE/PATCH)成功后自动失效相关缓存。
 */
const swrCache = new Map(); // key -> { data, ts, inflight }
const SWR_TTL = 12000;
const CACHEABLE_PATHS = ['/projects', '/hosts', '/personal/preferences', '/system/capabilities', '/ops/blueprints', '/cron'];

function isGet(opts) {
  return !opts?.method || opts.method === 'GET';
}
function cacheable(path, opts) {
  return isGet(opts) && (CACHEABLE_PATHS.includes(path) || opts.cacheable);
}
function doFetch(path, opts = {}) {
  return fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  }).then(async (res) => {
    if (!res.ok) {
      let msg = res.statusText;
      try {
        const body = await res.json();
        msg = body.message || body.error || JSON.stringify(body);
      } catch {}
      const err = new Error(msg);
      err.status = res.status;
      if (res.status === 401) window.dispatchEvent(new CustomEvent('composeops:unauthorized'));
      throw err;
    }
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.text();
  });
}
function revalidate(key, path, opts) {
  const entry = swrCache.get(key);
  if (!entry || entry.inflight) return;
  entry.inflight = true;
  doFetch(path, opts)
    .then((data) => swrCache.set(key, { data, ts: Date.now(), inflight: false }))
    .catch(() => swrCache.set(key, { ...entry, inflight: false }));
}
async function request(path, opts = {}) {
  if (!isGet(opts)) {
    const data = await doFetch(path, opts);
    invalidateSwr('/projects');
    invalidateSwr('/hosts');
    invalidateSwr('/personal/');
    invalidateSwr('/ops/');
    invalidateSwr('/cron');
    return data;
  }
  const key = path + (opts.cacheKey || '');
  const entry = swrCache.get(key);
  // 命中新鲜缓存:立即返回,后台 revalidate
  if (entry && !opts.force && Date.now() - entry.ts < SWR_TTL) {
    revalidate(key, path, opts);
    return entry.data;
  }
  // 命中过期缓存:先回旧值(秒开),后台刷新
  if (entry && !opts.force) {
    revalidate(key, path, opts);
    return entry.data;
  }
  // 无缓存:真实拉取,可缓存项落缓存
  const data = await doFetch(path, opts);
  if (cacheable(path, opts) && !opts.force) swrCache.set(key, { data, ts: Date.now(), inflight: false });
  return data;
}
/** 使某个路径前缀的 SWR 缓存失效(写操作后调用)。 */
export function invalidateSwr(prefix) {
  for (const key of [...swrCache.keys()]) {
    if (key.startsWith(prefix)) swrCache.delete(key);
  }
}

export const api = {
  getAuthStatus: () => request('/auth/status'),
  setup: (password) => request('/auth/setup', { method: 'POST', body: JSON.stringify({ password }) }),
  login: (password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  changePassword: (payload) => request('/auth/password', { method: 'POST', body: JSON.stringify(payload) }),
  getProjects: (force = false) => request('/projects', { force }),
  getMountPlan: () => request('/projects/mount-plan'),
  saveProjectManagement: (projectIds, mountProjectIds = []) => request('/projects/management', { method: 'PUT', body: JSON.stringify({ projectIds, mountProjectIds }) }),
  saveProjectMounts: (projectIds) => request('/projects/mounts', { method: 'PUT', body: JSON.stringify({ projectIds }) }),
  getProject: (id) => request(`/projects/${id}`),
  getProjectActivity: (id) => request(`/projects/${id}/activity`),
  listJobs: (limit = 20) => request(`/jobs?limit=${limit}`),
  getJob: (id) => request(`/jobs/${id}`),
  createProjectBatchJob: (projectIds, action) => request('/jobs', { method: 'POST', body: JSON.stringify({ projectIds, action }) }),
  saveProjectPreference: (id, payload) => request(`/projects/${id}/preferences`, { method: 'PATCH', body: JSON.stringify(payload) }),
  getComposeFile: (projectId, fileIndex = 0, force = false) => request(`/projects/${projectId}/compose?fileIndex=${fileIndex}`, { force }),
  saveComposeFile: (projectId, fileIndex, content) =>
    request(`/projects/${projectId}/compose`, { method: 'PUT', body: JSON.stringify({ fileIndex, content }) }),
  getProjectEnv: (projectId, force = false) => request(`/projects/${projectId}/env`, { force }),
  saveProjectEnv: (projectId, payload) => request(`/projects/${projectId}/env`, { method: 'PUT', body: JSON.stringify(payload) }),
  streamApplyEnv: (projectId, onFrame) => streamComposeControl(projectId, null, onFrame, `/projects/${projectId}/env/apply`, { restart: true }),
  getBackups: (projectId) => request(`/projects/${projectId}/backups`),
  getBackup: (projectId, backupId) => request(`/projects/${projectId}/backups/${backupId}`),
  restoreBackup: (projectId, backupId) => request(`/projects/${projectId}/backups/${backupId}/restore`, { method: 'POST' }),
  // docker hosts
  getHosts: (force = false) => request('/hosts', { force }),
  saveHost: (payload) => request('/hosts', { method: 'POST', body: JSON.stringify(payload) }),
  deleteHost: (id) => request(`/hosts/${id}`, { method: 'DELETE' }),
  pingHost: (id, probe) => request(`/hosts/${id}/ping`, { method: 'POST', body: JSON.stringify(probe ? { probe } : {}) }),
  setActiveHost: (hostId) => request('/hosts/active', { method: 'PUT', body: JSON.stringify({ hostId }) }),
  getActiveHost: () => request('/hosts/active'),
  // image update radar
  getProjectUpdates: (projectId, force = false) => request(`/projects/${projectId}/updates?force=${force ? '1' : '0'}`),
  getProjectWebUi: (projectId) => request(`/projects/${projectId}/webui`),
  listDbDumpTargets: (projectId) => request(`/projects/${projectId}/db-dump`),
  listCronJobs: () => request('/cron'),
  createCronJob: (payload) => request('/cron', { method: 'POST', body: JSON.stringify(payload) }),
  updateCronJob: (id, payload) => request(`/cron/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteCronJob: (id) => request(`/cron/${id}`, { method: 'DELETE' }),
  runCronJob: (id) => request(`/cron/${id}/run`, { method: 'POST' }),
  getCronHistory: (limit = 50) => request(`/cron/history?limit=${limit}`),
  // db dump
  streamDbDump: (projectId, containerId, dbName = '') =>
    fetch(`${BASE}/projects/${projectId}/db-dump`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ containerId, dbName }),
    }),
  streamUpgrade: (projectId, onFrame) => streamComposeControl(projectId, null, onFrame, `/projects/${projectId}/upgrade`, {}),
  streamRollback: (projectId, onFrame) => streamComposeControl(projectId, null, onFrame, `/projects/${projectId}/rollback`, {}),
  checkAllUpdates: () => request('/ops/updates/check-all', { method: 'POST' }),
  // docker storage
  getStorageDf: () => request('/ops/storage/df'),
  pruneStorage: (mode, confirm) => request('/ops/storage/prune', { method: 'POST', body: JSON.stringify({ mode, confirm }) }),
  // app blueprints
  getBlueprints: () => request('/ops/blueprints'),
  streamBlueprintDeploy: (blueprintId, values, onFrame) => streamComposeControl(null, null, onFrame, '/ops/blueprints/deploy', { blueprintId, values }),
  // alert events
  getNotificationEvents: () => request('/ops/notifications/events'),
  saveNotificationEvents: (events) => request('/ops/notifications/events', { method: 'PUT', body: JSON.stringify({ events }) }),
  // ai
  getAiConfig: () => request('/ai/config'),
  saveAiConfig: (payload) => request('/ai/config', { method: 'POST', body: JSON.stringify(payload) }),
  fetchAiModels: (payload = {}) => request('/ai/fetch-models', { method: 'POST', body: JSON.stringify(payload) }),
  getAiHistory: () => request('/ai/history'),
  clearAiHistory: () => request('/ai/history', { method: 'DELETE' }),
  // system
  getMetrics: () => request('/system/metrics'),
  getCapabilities: () => request('/system/capabilities'),
  getPreferences: () => request('/personal/preferences'),
  savePreferences: (payload) => request('/personal/preferences', { method: 'PUT', body: JSON.stringify(payload) }),
  getNotifications: () => request('/personal/notifications'),
  saveNotifications: (payload) => request('/personal/notifications', { method: 'PUT', body: JSON.stringify(payload) }),
  testNotifications: (payload) => request('/personal/notifications/test', { method: 'POST', body: JSON.stringify(payload) }),
  getOperations: () => request('/personal/operations'),
  getDockerUsage: () => request('/personal/maintenance/usage'),
  pruneDocker: (payload) => request('/personal/maintenance/prune', { method: 'POST', body: JSON.stringify(payload) }),
  getUpdateSettings: () => request('/personal/updates'),
  saveUpdateSettings: (payload) => request('/personal/updates', { method: 'PUT', body: JSON.stringify(payload) }),
  checkUpdates: () => request('/personal/updates/check', { method: 'POST' }),
  exportUrl: `${BASE}/personal/export`,
  importData: (payload) => request('/personal/import', { method: 'POST', body: JSON.stringify(payload) }),
};

/**
 * 调用 compose 控制端点(SSE 流式)。逐行解析 data: {...} 帧。
 * @param {object} body
 * @param {(frame:{type,data:string})=>void} onFrame
 * @returns {Promise<void>} resolve on stream end
 */
export async function streamComposeControl(projectId, action, onFrame, path = null, body = null) {
  const endpoint = path || `/projects/${projectId}/actions`;
  const res = await fetch(`${BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : JSON.stringify({ action }),
  });
  if (!res.ok || !res.body) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.message || payload.error || '控制请求失败');
  }
  invalidateSwr('/projects');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop();
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith('data:')) continue;
      try {
        onFrame(JSON.parse(line.slice(5).trim()));
      } catch {}
    }
  }
}

/**
 * AI 对话 / 诊断 SSE 流式
 */
export async function streamSse(path, body, onFrame, signal) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.message || payload.error || 'AI 请求失败');
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop();
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith('data:')) continue;
      try {
        onFrame(JSON.parse(line.slice(5).trim()));
      } catch {}
    }
  }
}

/** 项目容器实时资源指标 SSE 流(GET)。 */
export function streamProjectStats(projectId, onFrame, signal, interval = 2500) {
  return fetch(`${BASE}/projects/${projectId}/stats/stream?interval=${interval}`, { signal }).then(async (res) => {
    if (!res.ok || !res.body) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload.message || payload.error || '指标流请求失败');
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop();
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data:')) continue;
        try {
          onFrame(JSON.parse(line.slice(5).trim()));
        } catch {}
      }
    }
  });
}

/** 构造 WebSocket 绝对地址 */
export function wsUrl(path) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${path}`;
}
