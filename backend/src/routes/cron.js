import {
  listJobs,
  getJob,
  createJob,
  updateJob,
  deleteJob,
  runJobNow,
  listHistory,
  JOB_TYPES,
} from '../services/cron-scheduler.js';
import { addOperation } from '../lib/db.js';

export default async function cronRoutes(fastify) {
  fastify.get('/', async () => ({ jobs: await listJobs(), types: JOB_TYPES }));

  fastify.post('/', async (request, reply) => {
    try {
      const job = await createJob(request.body || {});
      addOperation({ action: 'cron.create', status: 'success', detail: `${job.name} (${job.cron})` });
      return job;
    } catch (error) {
      return reply.code(error.statusCode || 400).send({ error: 'cron_create_failed', message: error.message });
    }
  });

  fastify.put('/:id', async (request, reply) => {
    try {
      const job = await updateJob(request.params.id, request.body || {});
      addOperation({ action: 'cron.update', status: 'success', detail: job.name });
      return job;
    } catch (error) {
      return reply.code(error.statusCode || 400).send({ error: 'cron_update_failed', message: error.message });
    }
  });

  fastify.delete('/:id', async (request, reply) => {
    try {
      const result = await deleteJob(request.params.id);
      addOperation({ action: 'cron.delete', status: 'success', detail: request.params.id });
      return result;
    } catch (error) {
      return reply.code(error.statusCode || 404).send({ error: 'cron_delete_failed', message: error.message });
    }
  });

  fastify.post('/:id/run', async (request, reply) => {
    try {
      const result = await runJobNow(request.params.id);
      addOperation({ action: 'cron.run', status: 'success', detail: result.summary || '' });
      return result;
    } catch (error) {
      addOperation({ action: 'cron.run', status: 'failed', detail: error.message });
      return reply.code(error.statusCode || 502).send({ error: 'cron_run_failed', message: error.message });
    }
  });

  fastify.get('/history', async (request) => ({ history: await listHistory(request.query.limit) }));
}
