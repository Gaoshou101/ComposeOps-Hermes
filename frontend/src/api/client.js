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
    throw err;
  }
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

export const api = {
  // services
  getServices: () => request('/services'),
  // compose
  getComposeFile: (path) => request(`/compose/file?path=${encodeURIComponent(path)}`),
  saveComposeFile: (path, content) =>
    request('/compose/file', { method: 'POST', body: JSON.stringify({ path, content }) }),
  // ai
  getAiConfig: () => request('/ai/config'),
  saveAiConfig: (payload) => request('/ai/config', { method: 'POST', body: JSON.stringify(payload) }),
  getAiHistory: () => request('/ai/history'),
  clearAiHistory: () => request('/ai/history', { method: 'DELETE' }),
  // system
  getMetrics: () => request('/system/metrics'),
};

/**
 * 调用 compose 控制端点（SSE 流式）。逐行解析 data: {...} 帧。
 * @param {object} body
 * @param {(frame:{type,data:string})=>void} onFrame
 * @returns {Promise<void>} resolve on stream end
 */
export async function streamComposeControl(body, onFrame) {
  const res = await fetch(`${BASE}/compose/control`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error('control request failed');
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
export async function streamSse(path, body, onFrame) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error('ai request failed');
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
