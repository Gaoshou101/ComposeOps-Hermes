import {
  listHosts,
  upsertHost,
  deleteHost,
  pingHost,
  setActiveHost,
  getActiveHostId,
} from '../services/docker-hosts.js';
import { addOperation } from '../lib/db.js';

export default async function hostRoutes(fastify) {
  fastify.get('/', async () => ({ hosts: listHosts() }));

  fastify.post('/', async (request, reply) => {
    try {
      const host = upsertHost(request.body || {});
      addOperation({ action: 'hosts.save', status: 'success', detail: host.name });
      return reply.code(201).send({ host });
    } catch (error) {
      return reply.code(error.statusCode || 400).send({ error: 'host_invalid', message: error.message });
    }
  });

  fastify.delete('/:id', async (request, reply) => {
    try {
      const result = deleteHost(request.params.id);
      addOperation({ action: 'hosts.delete', status: 'success', detail: request.params.id });
      return result;
    } catch (error) {
      return reply.code(error.statusCode || 400).send({ error: 'host_delete_failed', message: error.message });
    }
  });

  fastify.post('/:id/ping', async (request, reply) => {
    try {
      const result = await pingHost(request.params.id, request.body?.probe || null);
      if (request.body?.probe) delete result.host;
      return result;
    } catch (error) {
      return reply.code(error.statusCode || 400).send({ error: 'host_ping_failed', message: error.message });
    }
  });

  fastify.put('/active', async (request, reply) => {
    try {
      const result = setActiveHost(request.body?.hostId || 'local');
      addOperation({ action: 'hosts.switch', status: 'success', detail: result.activeHostId });
      return result;
    } catch (error) {
      return reply.code(error.statusCode || 400).send({ error: 'host_switch_failed', message: error.message });
    }
  });

  fastify.get('/active', async () => ({ activeHostId: getActiveHostId() }));
}
