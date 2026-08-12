import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import path from 'path';
import { fileURLToPath } from 'url';
import serviceRoutes from './routes/services.js';
import composeRoutes from './routes/compose.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
});

// 注册 WebSocket 插件（Phase 3 使用）
await fastify.register(websocket, {
  options: { maxPayload: 10 * 1024 * 1024 },
});

// REST API 前缀：/api/v1
await fastify.register(
  async (api) => {
    await api.register(serviceRoutes, { prefix: '/services' });
    await api.register(composeRoutes, { prefix: '/compose' });
    // ws / ai / system 路由将在后续 phase 注册
  },
  { prefix: '/api/v1' }
);

// 健康检查
fastify.get('/health', async () => ({ status: 'ok', ts: Date.now() }));

// 生产环境静态托管前端 dist（Phase 5）
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
    fastify.log.info(`OpsDash backend listening on http://${HOST}:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
