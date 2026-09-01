import { getBackgroundJob, listBackgroundJobs } from '../lib/db.js';
import { createProjectBatchJob } from '../services/background-jobs.js';

/** listBackgroundJobs 内部 clamp 到 1..100,这里保持一致上限。 */
const limitQuery = {
  type: 'object',
  properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } },
};

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
};

export default async function jobRoutes(fastify) {
  fastify.get('/', { schema: { querystring: limitQuery } }, async (request) => ({
    jobs: listBackgroundJobs(request.query.limit),
  }));

  fastify.get('/:id', { schema: { params: idParams } }, async (request, reply) => {
    const job = getBackgroundJob(request.params.id);
    if (!job) return reply.code(404).send({ error: 'job_not_found', message: '后台任务不存在' });
    return job;
  });

  fastify.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['projectIds', 'action'],
        additionalProperties: false,
        properties: {
          projectIds: {
            type: 'array',
            minItems: 1,
            maxItems: 100,
            items: { type: 'string', minLength: 1, maxLength: 200 },
          },
          action: { type: 'string', enum: ['up', 'restart', 'stop', 'pull', 'ps'] },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const job = await createProjectBatchJob(request.body?.projectIds, request.body?.action);
      return reply.code(202).send(job);
    } catch (error) {
      return reply.code(error.statusCode || 500).send({ error: 'job_create_failed', message: error.message });
    }
  });
}
