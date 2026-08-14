import docker from '../services/docker.js';
import { findProject, scanProjects } from '../services/scanner.js';
import { buildMountPlan } from '../services/mount-plan.js';
import { readCompose, resolveProjectFile, saveCompose, spawnCompose } from '../services/compose-runner.js';
import {
  addOperation,
  getComposeBackup,
  listComposeBackups,
  setProjectPreference,
} from '../lib/db.js';

async function projectOr404(id, reply) {
  const project = await findProject(id);
  if (!project) reply.code(404).send({ error: 'project_not_found', message: '项目不存在或当前不可见' });
  return project;
}

export default async function projectRoutes(fastify) {
  fastify.get('/', async () => ({ projects: await scanProjects() }));

  fastify.get('/mount-plan', async () => buildMountPlan(await scanProjects()));

  fastify.get('/:id', async (request, reply) => {
    const project = await projectOr404(request.params.id, reply);
    if (project) return project;
  });

  fastify.patch('/:id/preferences', async (request, reply) => {
    const project = await projectOr404(request.params.id, reply);
    if (!project) return;
    const { favorite, note } = request.body || {};
    if (favorite !== undefined && typeof favorite !== 'boolean') {
      return reply.code(400).send({ error: 'invalid_favorite' });
    }
    if (note !== undefined && typeof note !== 'string') {
      return reply.code(400).send({ error: 'invalid_note' });
    }
    return setProjectPreference(project.id, { favorite, note });
  });

  fastify.get('/:id/compose', async (request, reply) => {
    const project = await projectOr404(request.params.id, reply);
    if (!project) return;
    if (!project.editable) return reply.code(409).send({ error: 'project_not_mounted', message: '项目目录未挂载' });
    try {
      return await readCompose(project, request.query.fileIndex || 0);
    } catch (error) {
      return reply.code(error.statusCode || 500).send({ error: 'compose_read_failed', message: error.message });
    }
  });

  fastify.put('/:id/compose', async (request, reply) => {
    const project = await projectOr404(request.params.id, reply);
    if (!project) return;
    if (!project.editable) return reply.code(409).send({ error: 'project_not_mounted', message: '项目目录未挂载' });
    try {
      const result = await saveCompose(project, request.body?.fileIndex || 0, request.body?.content);
      addOperation({ projectId: project.id, projectName: project.projectName, action: 'compose.save', status: 'success' });
      return result;
    } catch (error) {
      addOperation({ projectId: project.id, projectName: project.projectName, action: 'compose.save', status: 'failed', detail: error.message });
      return reply.code(error.statusCode || (error.code === 'YAML_PARSE_ERROR' ? 422 : 500))
        .send({ error: 'compose_save_failed', message: error.message, line: error.line, column: error.column });
    }
  });

  fastify.get('/:id/backups', async (request, reply) => {
    const project = await projectOr404(request.params.id, reply);
    if (!project) return;
    return { backups: listComposeBackups(project.id) };
  });

  fastify.get('/:id/backups/:backupId', async (request, reply) => {
    const project = await projectOr404(request.params.id, reply);
    if (!project) return;
    const backup = getComposeBackup(project.id, Number(request.params.backupId));
    if (!backup) return reply.code(404).send({ error: 'backup_not_found' });
    return backup;
  });

  fastify.post('/:id/backups/:backupId/restore', async (request, reply) => {
    const project = await projectOr404(request.params.id, reply);
    if (!project) return;
    const backup = getComposeBackup(project.id, Number(request.params.backupId));
    if (!backup) return reply.code(404).send({ error: 'backup_not_found' });
    const fileIndex = project.composeFiles.indexOf(backup.filePath);
    if (fileIndex < 0) return reply.code(409).send({ error: 'backup_file_changed' });
    try {
      await saveCompose(project, fileIndex, backup.content, 'restore');
      addOperation({ projectId: project.id, projectName: project.projectName, action: 'compose.restore', status: 'success', detail: `backup=${backup.id}` });
      return { ok: true };
    } catch (error) {
      return reply.code(error.statusCode || 500).send({ error: 'restore_failed', message: error.message });
    }
  });

  fastify.post('/:id/actions', async (request, reply) => {
    const project = await projectOr404(request.params.id, reply);
    if (!project) return;
    const action = request.body?.action;
    if (!project.editable) return reply.code(409).send({ error: 'project_not_mounted', message: '项目目录未挂载' });
    let child;
    try {
      const safeFiles = await Promise.all(project.composeFiles.map((_, index) => resolveProjectFile(project, index)));
      child = spawnCompose({ ...project, composeFiles: safeFiles }, action);
    } catch (error) {
      return reply.code(error.statusCode || 400).send({ error: 'unsupported_action', message: error.message });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (type, data) => {
      if (!reply.raw.destroyed) reply.raw.write(`data: ${JSON.stringify({ type, data })}\n\n`);
    };
    let output = '';
    let finished = false;
    child.stdout.on('data', (chunk) => { const text = chunk.toString('utf8'); output += text; send('stdout', text); });
    child.stderr.on('data', (chunk) => { const text = chunk.toString('utf8'); output += text; send('stderr', text); });
    child.on('error', (error) => send('error', error.message));
    child.on('close', async (code) => {
      finished = true;
      addOperation({
        projectId: project.id,
        projectName: project.projectName,
        action: `compose.${action}`,
        status: code === 0 ? 'success' : 'failed',
        detail: output,
      });
      send('exit', { code });
      reply.raw.end();
    });
    reply.raw.on('close', () => {
      if (!finished && child.exitCode === null && !child.killed) child.kill('SIGTERM');
    });
  });
}
