import { WebSocket } from 'ws';
import { findProjectContainer } from '../services/scanner.js';
import { getBackgroundJob } from '../lib/db.js';
import { subscribeJobEvents } from '../services/job-events.js';
import { getActivityDocker } from '../services/docker-hosts.js';
import { aggregateProjectLogs } from '../services/log-aggregator.js';
import { subscribeEvents } from '../services/events.js';

/**
 * WebSocket 路由：实时日志流与容器 Web Shell。
 *
 * - GET/WS /api/v1/ws/logs?containerId=<id>&tail=200
 *     绑定 Docker API /containers/{id}/logs?follow=true&stdout=true&stderr=true
 * - GET/WS /api/v1/ws/exec?containerId=<id>[&cmd=sh]
 *     基于 xterm.js 的交互式容器 shell
 *
 * 这些路由挂在 /ws 前缀（不经过 /api/v1），方便 nginx 反代区分。
 */
export default async function wsRoutes(fastify) {
  // ---- 容器状态实时推送 ----
  fastify.get('/containers', { websocket: true }, async (socket) => {
    const { subscribeContainerEvents, getContainersSnapshot } = await import('../services/container-events.js');
    
    // 先发送当前快照,避免客户端连接时机导致状态丢失
    try {
      const snapshot = await getContainersSnapshot();
      safeSend(socket, snapshot);
    } catch (e) {
      safeSend(socket, { type: 'error', data: e.message });
    }

    // 订阅实时事件
    const unsubscribe = subscribeContainerEvents((event) => {
      safeSend(socket, event);
    });
    
    socket.on('close', unsubscribe);
  });

  // ---- 告警事件实时流 ----
  fastify.get('/events', { websocket: true }, async (socket) => {
    const unsubscribe = subscribeEvents((event) => {
      safeSend(socket, { type: 'event', data: event });
    });
    socket.on('close', unsubscribe);
  });

  // ---- 批量任务进度推送 ----
  fastify.get('/jobs', { websocket: true }, async (socket, request) => {
    const { jobId } = request.query;
    if (jobId) {
      const job = getBackgroundJob(String(jobId));
      if (!job) {
        safeSend(socket, { type: 'error', data: 'job not found' });
        return socket.close();
      }
      // 先发当前全量快照，避免依赖连接时序丢状态；DB 为唯一事实来源。
      safeSend(socket, { type: 'snapshot', job });
    }
    const unsubscribe = subscribeJobEvents(({ jobId: id, event, ...rest }) => {
      if (id !== jobId) return; // 只推订阅的任务
      const job = getBackgroundJob(id);
      if (!job) return;
      safeSend(socket, { type: 'update', event, ...rest, job });
    });
    socket.on('close', unsubscribe);
  });

  // ---- 实时日志流 ----
  fastify.get('/logs', { websocket: true }, async (socket, request) => {
    const { projectId, containerId, tail = 200 } = request.query;
    if (!projectId || !containerId) {
      socket.send(JSON.stringify({ type: 'error', data: 'missing projectId or containerId' }));
      return socket.close();
    }
    const match = await findProjectContainer(projectId, containerId);
    if (match.project && !match.project.managed) {
      socket.send(JSON.stringify({ type: 'error', data: '项目尚未加入管理' }));
      return socket.close();
    }
    if (!match.container) {
      socket.send(JSON.stringify({ type: 'error', data: 'container not found in project' }));
      return socket.close();
    }
    const container = getActivityDocker().getContainer(match.container.id);

    let logStream;
    try {
      logStream = await container.logs({
        follow: true,
        stdout: true,
        stderr: true,
        tail: String(Math.max(0, Math.min(Number(tail) || 200, 5000))),
        timestamps: true,
      });
    } catch (e) {
      socket.send(JSON.stringify({ type: 'error', data: e.message }));
      return socket.close();
    }

    // Docker log stream 是 multiplexed（stdout/stderr 8 字节头），用 demuxStream 拆分。
    const inspection = await container.inspect().catch(() => null);
    const emitLine = (type, text) => {
      for (const rawLine of text.split('\n')) {
        if (!rawLine.trim()) continue;
        let data = rawLine;
        let ts = null;
        const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\s?(.*)$/.exec(rawLine);
        if (m) { ts = m[1]; data = m[2]; }
        safeSend(socket, { type, data, ts, level: classifyLogLevel(data) });
      }
    };
    if (inspection?.Config?.Tty) {
      logStream.on('data', (b) => emitLine('stdout', b.toString('utf8')));
    } else {
      const { demuxStream } = await import('../lib/docker-streams.js');
      const demux = demuxStream();
      logStream.pipe(demux);
      demux.stdout.on('data', (b) => emitLine('stdout', b.toString('utf8')));
      demux.stderr.on('data', (b) => emitLine('stderr', b.toString('utf8')));
    }

    logStream.on('error', (e) => safeSend(socket, { type: 'error', data: e.message }));
    logStream.on('end', () => {
      safeSend(socket, { type: 'end', data: 'log stream ended' });
      try { socket.close(); } catch {}
    });

    // 客户端断开 -> 停止日志流
    socket.on('close', () => {
      try { logStream.destroy(); } catch {}
    });
  });

  // ---- 多容器聚合日志流 ----
  fastify.get('/aggregated-logs', { websocket: true }, async (socket, request) => {
    const { projectId, containers } = request.query;
    if (!projectId) {
      safeSend(socket, { type: 'error', data: 'missing projectId' });
      return socket.close();
    }
    const { findProject } = await import('../services/scanner.js');
    const project = await findProject(String(projectId)).catch(() => null);
    if (!project) {
      safeSend(socket, { type: 'error', data: 'project not found' });
      return socket.close();
    }
    if (!project.managed) {
      safeSend(socket, { type: 'error', data: '项目尚未加入管理' });
      return socket.close();
    }
    const ids = String(containers || '').split(',').map((item) => item.trim()).filter(Boolean);
    let aggregator;
    try {
      aggregator = await aggregateProjectLogs({
        project,
        containerIds: ids,
        onLine: (line) => safeSend(socket, { type: 'line', data: line }),
      });
      safeSend(socket, { type: 'meta', data: { count: ids.length || project.containers.length } });
    } catch (e) {
      safeSend(socket, { type: 'error', data: e.message });
      return socket.close();
    }
    socket.on('close', () => { if (aggregator) aggregator.stop(); });
  });

  // ---- 容器 Web Shell ----
  fastify.get('/exec', { websocket: true }, async (socket, request) => {
    if (process.env.ENABLE_SHELL !== '1') {
      socket.send(JSON.stringify({ type: 'error', data: 'Web Shell 未启用' }));
      return socket.close();
    }
    const { projectId, containerId, cmd = 'sh' } = request.query;
    if (!projectId || !containerId) {
      socket.send(JSON.stringify({ type: 'error', data: 'missing projectId or containerId' }));
      return socket.close();
    }
    if (!['sh', 'bash'].includes(cmd)) {
      socket.send(JSON.stringify({ type: 'error', data: '只允许 sh 或 bash' }));
      return socket.close();
    }
    const match = await findProjectContainer(projectId, containerId);
    if (match.project && !match.project.managed) {
      socket.send(JSON.stringify({ type: 'error', data: '项目尚未加入管理' }));
      return socket.close();
    }
    if (!match.container) {
      socket.send(JSON.stringify({ type: 'error', data: 'container not found in project' }));
      return socket.close();
    }
    const container = getActivityDocker().getContainer(match.container.id);

    let exec;
    try {
      exec = await container.exec({
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        Cmd: [cmd],
      });
    } catch (e) {
      socket.send(JSON.stringify({ type: 'error', data: e.message }));
      return socket.close();
    }

    let stream;
    try {
      stream = await exec.start({ hijack: true, stdin: true, Tty: true });
    } catch (e) {
      socket.send(JSON.stringify({ type: 'error', data: e.message }));
      return socket.close();
    }

    // Tty 模式下 stream 无需 demux，直接透传字节。
    stream.on('data', (b) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(b);
    });
    stream.on('error', (e) => {
      safeSend(socket, { type: 'error', data: e.message });
    });
    stream.on('end', () => {
      try { socket.close(); } catch {}
    });

    // 统一收消息：JSON 控制帧（resize）走控制路径，二进制/文本走容器 stdin。
    socket.on('message', (data, isBinary) => {
      // 仅在文本帧且以 { 开头时尝试解析为控制帧
      if (!isBinary) {
        const text = data.toString('utf8');
        if (text.startsWith('{')) {
          try {
            const msg = JSON.parse(text);
            if (msg.type === 'resize' && msg.cols && msg.rows) {
              exec.resize({ h: msg.rows, w: msg.cols }).catch(() => {});
              return;
            }
            // 其它未知控制帧忽略，不写入 stdin
            return;
          } catch {
            // 解析失败视为普通输入
          }
        }
      }
      try {
        if (stream.writable) stream.write(Buffer.isBuffer(data) ? data : Buffer.from(data));
      } catch {}
    });

    socket.on('close', () => {
      try { stream.destroy(); } catch {}
    });
  });
}

function safeSend(socket, payload) {
  try {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
    }
  } catch {}
}

/** 日志行级别分类:error / warn / info,供前端过滤与高亮。 */
function classifyLogLevel(text = '') {
  const t = String(text);
  if (/(error|exception|fatal|panic|crash|failed)/i.test(t)) return 'error';
  if (/(warn|deprecat)/i.test(t)) return 'warn';
  return 'info';
}
