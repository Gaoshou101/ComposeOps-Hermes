/**
 * GitOps 路由
 */

import {
  listGitOpsRepos,
  addGitOpsRepo,
  updateGitOpsRepo,
  deleteGitOpsRepo,
  syncGitOpsRepo,
  getGitOpsHistory,
  rollbackGitOpsRepo,
} from '../services/gitops.js';
import { addOperation } from '../lib/db.js';

const repoIdParam = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1, maxLength: 200 } },
};

const addRepoBody = {
  type: 'object',
  required: ['name', 'url', 'localPath', 'projectId'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    url: { type: 'string', minLength: 1, maxLength: 500 },
    branch: { type: 'string', maxLength: 100 },
    localPath: { type: 'string', minLength: 1, maxLength: 500 },
    projectId: { type: 'string', minLength: 1, maxLength: 200 },
    autoSync: { type: 'boolean' },
    sshKey: { type: 'string', maxLength: 10000 },
  },
};

const updateRepoBody = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', maxLength: 200 },
    url: { type: 'string', maxLength: 500 },
    branch: { type: 'string', maxLength: 100 },
    localPath: { type: 'string', maxLength: 500 },
    projectId: { type: 'string', maxLength: 200 },
    autoSync: { type: 'boolean' },
    sshKey: { type: 'string', maxLength: 10000 },
  },
};

const rollbackBody = {
  type: 'object',
  required: ['commitHash'],
  additionalProperties: false,
  properties: {
    commitHash: { type: 'string', minLength: 7, maxLength: 40 },
  },
};

export default async function gitopsRoutes(fastify) {
  // 列出所有 GitOps 仓库
  fastify.get('/', async () => {
    return { repositories: listGitOpsRepos() };
  });

  // 添加 GitOps 仓库
  fastify.post('/', { schema: { body: addRepoBody } }, async (request, reply) => {
    try {
      const repo = addGitOpsRepo(request.body);
      addOperation({ action: 'gitops.add', status: 'success', detail: repo.name });
      return repo;
    } catch (error) {
      return reply.code(error.statusCode || 500).send({
        error: 'gitops_add_failed',
        message: error.message,
      });
    }
  });

  // 更新 GitOps 仓库配置
  fastify.patch('/:id', {
    schema: { params: repoIdParam, body: updateRepoBody },
  }, async (request, reply) => {
    try {
      const repo = updateGitOpsRepo(request.params.id, request.body);
      addOperation({ action: 'gitops.update', status: 'success', detail: repo.name });
      return repo;
    } catch (error) {
      return reply.code(error.statusCode || 500).send({
        error: 'gitops_update_failed',
        message: error.message,
      });
    }
  });

  // 删除 GitOps 仓库
  fastify.delete('/:id', { schema: { params: repoIdParam } }, async (request, reply) => {
    try {
      const result = deleteGitOpsRepo(request.params.id);
      addOperation({ action: 'gitops.delete', status: 'success', detail: request.params.id });
      return result;
    } catch (error) {
      return reply.code(error.statusCode || 500).send({
        error: 'gitops_delete_failed',
        message: error.message,
      });
    }
  });

  // 手动同步仓库
  fastify.post('/:id/sync', { schema: { params: repoIdParam } }, async (request, reply) => {
    try {
      const result = await syncGitOpsRepo(request.params.id);
      addOperation({
        action: 'gitops.sync',
        status: 'success',
        detail: `${request.params.id}: ${result.commit.slice(0, 7)}`,
      });
      return result;
    } catch (error) {
      return reply.code(error.statusCode || 500).send({
        error: 'gitops_sync_failed',
        message: error.message,
      });
    }
  });

  // 获取 Git 历史
  fastify.get('/:id/history', {
    schema: {
      params: repoIdParam,
      querystring: {
        type: 'object',
        properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } },
      },
    },
  }, async (request, reply) => {
    try {
      return await getGitOpsHistory(request.params.id, request.query.limit);
    } catch (error) {
      return reply.code(error.statusCode || 500).send({
        error: 'gitops_history_failed',
        message: error.message,
      });
    }
  });

  // 回滚到指定 commit
  fastify.post('/:id/rollback', {
    schema: { params: repoIdParam, body: rollbackBody },
  }, async (request, reply) => {
    try {
      const result = await rollbackGitOpsRepo(request.params.id, request.body.commitHash);
      addOperation({
        action: 'gitops.rollback',
        status: 'success',
        detail: `${request.params.id}: ${result.commit.slice(0, 7)}`,
      });
      return result;
    } catch (error) {
      return reply.code(error.statusCode || 500).send({
        error: 'gitops_rollback_failed',
        message: error.message,
      });
    }
  });
}
