import docker from '../services/docker.js';
import { findProject, scanProjects } from '../services/scanner.js';
import { buildMountPlan } from '../services/mount-plan.js';
import { readCompose, saveCompose } from '../services/compose-runner.js';
import { pruneWorkspaceRunners, readWorkspaceCompose, saveWorkspaceCompose } from '../services/compose-workspace.js';
import { prepareProjectAction } from '../services/project-action-runner.js';
import { readProjectEnv, saveProjectEnv, applyProjectEnv, assertEnvAccess } from '../services/project-env.js';
import { readContainerStat } from '../services/stats.js';
import {
  addOperation,
  getComposeBackup,
  listComposeBackups,
  listProjectOperations,
  setProjectManagement,
  setProjectPreference,
} from '../lib/db.js';

async function projectOr404(id, reply) {
  const project = await findProject(id);
  if (!project) reply.code(404).send({ error: 'project_not_found', message: '项目不存在或当前不可见' });
  return project;
}

function requireManaged(project, reply) {
  if (!project.managed) {
    reply.code(403).send({ error: 'project_not_managed', message: '项目尚未加入管理，请先在项目纳管中勾选' });
    return false;
  }
  return true;
}

function requireEditable(project, reply) {
  if (!requireManaged(project, reply)) return false;
  if (!project.mountEnabled) {
    reply.code(403).send({ error: 'compose_access_not_enabled', message: '尚未为该项目启用 Compose 目录能力' });
    return false;
  }
  if (!project.editable) {
    reply.code(409).send({ error: 'compose_path_unavailable', message: 'Compose 项目路径缺失或权限范围过宽，无法安全挂载' });
    return false;
  }
  return true;
}

export default async function projectRoutes(fastify) {
  fastify.get('/', async () => ({ projects: await scanProjects() }));

  fastify.get('/mount-plan', async () => buildMountPlan(await scanProjects()));

  fastify.put('/management', async (request, reply) => {
    const projectIds = request.body?.projectIds;
    const mountProjectIds = request.body?.mountProjectIds ?? [];
    if (!Array.isArray(projectIds) || projectIds.length > 1000 ||
        projectIds.some((id) => typeof id !== 'string') ||
        !Array.isArray(mountProjectIds) || mountProjectIds.length > 1000 ||
        mountProjectIds.some((id) => typeof id !== 'string')) {
      return reply.code(400).send({ error: 'invalid_project_ids', message: '项目选择格式无效' });
    }
    const projects = await scanProjects();
    const discoveredIds = projects.map((project) => project.id);
    const discoveredSet = new Set(discoveredIds);
    if (projectIds.some((id) => !discoveredSet.has(id)) || mountProjectIds.some((id) => !discoveredSet.has(id))) {
      return reply.code(400).send({ error: 'unknown_project', message: '选择中包含当前未发现的项目' });
    }
    const selectedIds = [...new Set(projectIds)];
    const selectedMountIds = [...new Set(mountProjectIds)].filter((id) => selectedIds.includes(id));
    const result = setProjectManagement(discoveredIds, selectedIds, selectedMountIds);
    pruneWorkspaceRunners(selectedMountIds);
    addOperation({
      action: 'projects.management',
      status: 'success',
      detail: projects.filter((project) => selectedIds.includes(project.id)).map((project) => project.projectName).join(', '),
    });
    return result;
  });

  // 目录能力是纳管权限的子集。保留独立端点，便于设置页只调整挂载选择。
  fastify.put('/mounts', async (request, reply) => {
    const mountProjectIds = request.body?.projectIds;
    if (!Array.isArray(mountProjectIds) || mountProjectIds.length > 1000 ||
        mountProjectIds.some((id) => typeof id !== 'string')) {
      return reply.code(400).send({ error: 'invalid_project_ids', message: '项目选择格式无效' });
    }
    const projects = await scanProjects();
    const discoveredIds = projects.map((project) => project.id);
    const discoveredSet = new Set(discoveredIds);
    if (mountProjectIds.some((id) => !discoveredSet.has(id))) {
      return reply.code(400).send({ error: 'unknown_project', message: '选择中包含当前未发现的项目' });
    }
    const managedIds = projects.filter((project) => project.managed).map((project) => project.id);
    const selectedMountIds = [...new Set(mountProjectIds)].filter((id) => managedIds.includes(id));
    const result = setProjectManagement(discoveredIds, managedIds, selectedMountIds);
    pruneWorkspaceRunners(selectedMountIds);
    addOperation({ action: 'projects.mounts', status: 'success', detail: selectedMountIds.join(', ') });
    return result;
  });

  fastify.get('/:id', async (request, reply) => {
    const project = await projectOr404(request.params.id, reply);
    if (project) return project;
  });

  fastify.get('/:id/activity', async (request, reply) => {
    const project = await projectOr404(request.params.id, reply);
    if (!project) return;
    if (!requireManaged(project, reply)) return;
    return {
      project: { id: project.id, projectName: project.projectName, editable: project.editable },
      operations: listProjectOperations(project.id, request.query.limit),
      backups: listComposeBackups(project.id),
    };
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
    if (!requireEditable(project, reply)) return;
    try {
      return project.mounted
        ? await readCompose(project, request.query.fileIndex || 0)
        : await readWorkspaceCompose(project, request.query.fileIndex || 0);
    } catch (error) {
      return reply.code(error.statusCode || 500).send({ error: 'compose_read_failed', message: error.message });
    }
  });

  fastify.put('/:id/compose', async (request, reply) => {
    const project = await projectOr404(request.params.id, reply);
    if (!project) return;
    if (!requireEditable(project, reply)) return;
    try {
      const result = project.mounted
        ? await saveCompose(project, request.body?.fileIndex || 0, request.body?.content)
        : await saveWorkspaceCompose(project, request.body?.fileIndex || 0, request.body?.content);
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
    if (!requireManaged(project, reply)) return;
    return { backups: listComposeBackups(project.id) };
  });

  fastify.get('/:id/backups/:backupId', async (request, reply) => {
    const project = await projectOr404(request.params.id, reply);
    if (!project) return;
    if (!requireManaged(project, reply)) return;
    const backup = getComposeBackup(project.id, Number(request.params.backupId));
    if (!backup) return reply.code(404).send({ error: 'backup_not_found' });
    return backup;
  });

  fastify.post('/:id/backups/:backupId/restore', async (request, reply) => {
    const project = await projectOr404(request.params.id, reply);
    if (!project) return;
    if (!requireEditable(project, reply)) return;
    const backup = getComposeBackup(project.id, Number(request.params.backupId));
    if (!backup) return reply.code(404).send({ error: 'backup_not_found' });
    const fileIndex = project.composeFiles.indexOf(backup.filePath);
    if (fileIndex < 0) return reply.code(409).send({ error: 'backup_file_changed' });
    try {
      if (project.mounted) await saveCompose(project, fileIndex, backup.content, 'restore');
      else await saveWorkspaceCompose(project, fileIndex, backup.content, 'restore');
      addOperation({ projectId: project.id, projectName: project.projectName, action: 'compose.restore', status: 'success', detail: `backup=${backup.id}` });
      return { ok: true };
    } catch (error) {
      return reply.code(error.statusCode || 500).send({ error: 'restore_failed', message: error.message });
    }
  });

  // ---- 环境变量(.env)读取 / 保存 / 应用 ----
  fastify.get('/:id/env', async (request, reply) => {
    const project = await projectOr404(request.params.id, reply);
    if (!project) return;
    try {
      assertEnvAccess(project);
      return await readProjectEnv(project);
    } catch (error) {
      return reply.code(error.statusCode || 500).send({ error: 'env_read_failed', message: error.message });
    }
  });

  fastify.put('/:id/env', async (request, reply) => {
    const project = await projectOr404(request.params.id, reply);
    if (!project) return;
    try {
      assertEnvAccess(project);
      const { raw, entries } = request.body || {};
      const result = await saveProjectEnv(project, { raw, entries });
      return result;
    } catch (error) {
      addOperation({ projectId: project.id, projectName: project.projectName, action: 'env.save', status: 'failed', detail: error.message });
      return reply.code(error.statusCode || 500).send({ error: 'env_save_failed', message: error.message });
    }
  });

  fastify.post('/:id/env/apply', async (request, reply) => {
    const project = await projectOr404(request.params.id, reply);
    if (!project) return;
    try {
      assertEnvAccess(project);
    } catch (error) {
      return reply.code(error.statusCode || 400).send({ error: 'env_apply_forbidden', message: error.message });
    }
    const restart = request.body?.restart !== false;
    if (!restart) return reply.send({ ok: true, restarted: false });

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
    const finish = (code) => {
      if (finished) return;
      finished = true;
      addOperation({ projectId: project.id, projectName: project.projectName, action: 'env.apply', status: code === 0 ? 'success' : 'failed', detail: output });
      send('exit', { code });
      reply.raw.end();
    };
    let child;
    applyProjectEnv(project, {
      onOutput: (type, text) => { output += text; send(type, text); },
      onChild: (process) => { child = process; },
    }).then(finish).catch((error) => {
      const text = `${error.message}\n`;
      output += text;
      send('stderr', text);
      finish(1);
    });
    reply.raw.on('close', () => {
      if (!finished && child && child.exitCode === null && !child.killed) child.kill('SIGTERM');
    });
  });

  // ---- 项目容器实时资源指标流(SSE,2.5s 周期,客户端断开自动销毁) ----
  fastify.get('/:id/stats/stream', async (request, reply) => {
    const project = await projectOr404(request.params.id, reply);
    if (!project) return;
    if (!requireManaged(project, reply)) return;
    const interval = Math.max(1000, Math.min(Number(request.query.interval) || 2500, 10000));
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (frame) => {
      if (!reply.raw.destroyed) reply.raw.write(`data: ${JSON.stringify(frame)}\n\n`);
    };
    let running = true;
    let timer = null;
    let inFlight = null;
    async function tick() {
      if (!running || inFlight) return;
      inFlight = (async () => {
        const containers = project.containers.filter((item) => item.state === 'running');
        const rows = await Promise.all(containers.map(async (item) => {
          try {
            const stat = await readContainerStat(item.id);
            return {
              containerId: item.id,
              name: item.name,
              ...stat,
            };
          } catch {
            return null;
          }
        }));
        send({ type: 'stats', data: rows.filter(Boolean), ts: Date.now() });
      })().catch((error) => {
        send({ type: 'error', data: error.message });
      }).finally(() => {
        inFlight = null;
      });
    }
    timer = setInterval(() => void tick(), interval);
    timer.unref?.();
    void tick();
    reply.raw.on('close', () => {
      running = false;
      if (timer) clearInterval(timer);
    });
  });

  fastify.post('/:id/actions', async (request, reply) => {
    const project = await projectOr404(request.params.id, reply);
    if (!project) return;
    const action = request.body?.action;
    let prepared;
    try { prepared = await prepareProjectAction(project, action); }
    catch (error) { return reply.code(error.statusCode || 400).send({ error: 'unsupported_action', message: error.message }); }

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
    const finish = (code) => {
      if (finished) return;
      finished = true;
      addOperation({
        projectId: project.id,
        projectName: project.projectName,
        action: `${prepared.mode}.${action}`,
        status: code === 0 ? 'success' : 'failed',
        detail: output,
      });
      send('exit', { code });
      reply.raw.end();
    };
    let child;
    prepared.run((type, text) => { output += text; send(type, text); }, (process) => { child = process; })
      .then(finish)
      .catch((error) => { const text = `${error.message}\n`; output += text; send('stderr', text); finish(1); });
    reply.raw.on('close', () => {
      if (!finished && child && child.exitCode === null && !child.killed) child.kill('SIGTERM');
    });
  });
}
