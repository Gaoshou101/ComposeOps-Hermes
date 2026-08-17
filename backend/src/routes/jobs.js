import { getBackgroundJob, listBackgroundJobs } from '../lib/db.js';
import { createProjectBatchJob } from '../services/background-jobs.js';

export default async function jobRoutes(fastify) {
  fastify.get('/', async (request) => ({ jobs: listBackgroundJobs(request.query.limit) }));

  fastify.get('/:id', async (request, reply) => {
    const job = getBackgroundJob(request.params.id);
    if (!job) return reply.code(404).send({ error: 'job_not_found', message: '后台任务不存在' });
    return job;
  });

  fastify.post('/', async (request, reply) => {
    try {
      const job = await createProjectBatchJob(request.body?.projectIds, request.body?.action);
      return reply.code(202).send(job);
    } catch (error) {
      return reply.code(error.statusCode || 500).send({ error: 'job_create_failed', message: error.message });
    }
  });
}
