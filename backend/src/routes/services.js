import { scanAndGroupServices } from '../services/scanner.js';

export default async function serviceRoutes(fastify) {
  // GET /api/v1/services
  // 返回全局服务列表与所有 Owner 分组清单
  fastify.get('/', async (request, reply) => {
    try {
      const data = await scanAndGroupServices();
      return data;
    } catch (err) {
      fastify.log.error(err, 'scan services failed');
      return reply.code(502).send({ error: 'docker_unavailable', message: err.message });
    }
  });
}
