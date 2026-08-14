import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import path from 'path';
import { fileURLToPath } from 'url';
import serviceRoutes from './routes/services.js';
import projectRoutes from './routes/projects.js';
import aiRoutes from './routes/ai.js';
import systemRoutes from './routes/system.js';
import wsRoutes from './routes/ws.js';
import authRoutes from './routes/auth.js';
import personalRoutes from './routes/personal.js';
import docker from './services/docker.js';
import { isAuthenticated, isConfigured, setPassword, validateOrigin } from './lib/auth.js';
import { startAlertMonitor, stopAlertMonitor } from './services/alert-monitor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

const fastify = Fastify({
  trustProxy: process.env.TRUST_PROXY === '1',
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
});

// 实时日志与终端共享同一认证边界。
await fastify.register(websocket, {
  options: { maxPayload: 10 * 1024 * 1024 },
});

// dockerode 实例挂载到 fastify 上供 ws 路由使用
fastify.decorate('docker', docker);

fastify.addHook('onSend', async (request, reply, payload) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  reply.header('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self' blob:");
  return payload;
});

if (!isConfigured() && process.env.ADMIN_PASSWORD) {
  setPassword(process.env.ADMIN_PASSWORD);
}

fastify.addHook('onRequest', async (request, reply) => {
  const protectedPath = request.url.startsWith('/api/v1/') || request.url.startsWith('/ws/');
  const pathname = request.url.split('?')[0];
  const publicAuthPath = [
    '/api/v1/auth/status',
    '/api/v1/auth/setup',
    '/api/v1/auth/login',
  ].includes(pathname);
  if (protectedPath && !publicAuthPath && !isAuthenticated(request)) {
    return reply.code(401).send({ error: 'unauthorized', message: '请先登录' });
  }
  if (request.url.startsWith('/ws/') && !validateOrigin(request)) {
    return reply.code(403).send({ error: 'origin_rejected', message: 'WebSocket 请求来源不可信' });
  }
  if (protectedPath && !['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !validateOrigin(request)) {
    return reply.code(403).send({ error: 'origin_rejected', message: '请求来源不可信' });
  }
});

// REST API 前缀：/api/v1
await fastify.register(
  async (api) => {
    await api.register(authRoutes, { prefix: '/auth' });
    await api.register(serviceRoutes, { prefix: '/services' });
    await api.register(projectRoutes, { prefix: '/projects' });
    await api.register(aiRoutes, { prefix: '/ai' });
    await api.register(systemRoutes, { prefix: '/system' });
    await api.register(personalRoutes, { prefix: '/personal' });
  },
  { prefix: '/api/v1' }
);

// WebSocket 路由前缀（不经过 /api/v1，便于代理区分）
await fastify.register(wsRoutes, { prefix: '/ws' });

// 健康检查
fastify.get('/health', async () => ({ status: 'ok', ts: Date.now() }));

// 生产环境静态托管前端 dist。
if (process.env.SERVE_FRONTEND === '1') {
  const staticRoot = path.join(__dirname, '../../frontend/dist');
  try {
    const fastifyStatic = (await import('@fastify/static')).default;
    await fastify.register(fastifyStatic, {
      root: staticRoot,
      prefix: '/',
      decorateReply: false,
    });
    // SPA fallback
    fastify.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api') || request.url.startsWith('/ws')) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return reply.sendFile('index.html');
    });
  } catch {
    fastify.log.warn('frontend dist not found, skipping static serving');
  }
}

const start = async () => {
  try {
    await fastify.listen({ port: PORT, host: HOST });
    startAlertMonitor();
    fastify.log.info(`OpsDash backend listening on http://${HOST}:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

fastify.addHook('onClose', async () => stopAlertMonitor());

start();
