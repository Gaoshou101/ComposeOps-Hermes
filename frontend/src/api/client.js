// 统一 API 客户端，基于 fetch 封装
const BASE = '/api/v1';

async function request(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
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
}

export const api = {
  getAuthStatus: () => request('/auth/status'),
  setup: (password) => request('/auth/setup', { method: 'POST', body: JSON.stringify({ password }) }),
  login: (password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  changePassword: (payload) => request('/auth/password', { method: 'POST', body: JSON.stringify(payload) }),
  getProjects: () => request('/projects'),
  getMountPlan: () => request('/projects/mount-plan'),
  saveProjectManagement: (projectIds, mountProjectIds = []) => request('/projects/management', { method: 'PUT', body: JSON.stringify({ projectIds, mountProjectIds }) }),
  saveProjectMounts: (projectIds) => request('/projects/mounts', { method: 'PUT', body: JSON.stringify({ projectIds }) }),
  getProject: (id) => request(`/projects/${id}`),
  saveProjectPreference: (id, payload) => request(`/projects/${id}/preferences`, { method: 'PATCH', body: JSON.stringify(payload) }),
  getComposeFile: (projectId, fileIndex = 0) => request(`/projects/${projectId}/compose?fileIndex=${fileIndex}`),
  saveComposeFile: (projectId, fileIndex, content) =>
    request(`/projects/${projectId}/compose`, { method: 'PUT', body: JSON.stringify({ fileIndex, content }) }),
  getBackups: (projectId) => request(`/projects/${projectId}/backups`),
  getBackup: (projectId, backupId) => request(`/projects/${projectId}/backups/${backupId}`),
  restoreBackup: (projectId, backupId) => request(`/projects/${projectId}/backups/${backupId}/restore`, { method: 'POST' }),
  // ai
  getAiConfig: () => request('/ai/config'),
  saveAiConfig: (payload) => request('/ai/config', { method: 'POST', body: JSON.stringify(payload) }),
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
 * 调用 compose 控制端点（SSE 流式）。逐行解析 data: {...} 帧。
 * @param {object} body
 * @param {(frame:{type,data:string})=>void} onFrame
 * @returns {Promise<void>} resolve on stream end
 */
export async function streamComposeControl(projectId, action, onFrame) {
  const res = await fetch(`${BASE}/projects/${projectId}/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || body.error || '控制请求失败');
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

/** 构造 WebSocket 绝对地址 */
export function wsUrl(path) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${path}`;
}
