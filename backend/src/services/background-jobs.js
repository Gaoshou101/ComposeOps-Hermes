import { randomUUID } from 'crypto';
import {
  addOperation,
  createBackgroundJob,
  getBackgroundJob,
  interruptRunningBackgroundJobs,
  updateBackgroundJob,
  updateBackgroundJobItem,
} from '../lib/db.js';
import { findProject as scannerFindProject, scanProjects } from './scanner.js';
import {
  assertProjectActionAllowed,
  prepareProjectAction as runnerPrepareProjectAction,
} from './project-action-runner.js';
import { emitJobUpdate } from './job-events.js';

const ACTIONS = new Set(['up', 'restart', 'stop', 'pull', 'ps']);

export function initializeBackgroundJobs() {
  return interruptRunningBackgroundJobs();
}

export async function createProjectBatchJob(projectIds, action) {
  if (!ACTIONS.has(action)) throw Object.assign(new Error('不支持的批量操作'), { statusCode: 400 });
  if (!Array.isArray(projectIds) || !projectIds.length || projectIds.length > 100 || projectIds.some((id) => typeof id !== 'string')) {
    throw Object.assign(new Error('项目选择格式无效'), { statusCode: 400 });
  }
  const uniqueIds = [...new Set(projectIds)];
  const projects = await scanProjects();
  const selected = uniqueIds.map((id) => projects.find((project) => project.id === id));
  if (selected.some((project) => !project)) throw Object.assign(new Error('选择中包含当前未发现的项目'), { statusCode: 400 });
  for (const project of selected) assertProjectActionAllowed(project, action);
  const id = randomUUID();
  const job = createBackgroundJob({ id, type: 'project.batch', action, projects: selected });
  emitJobUpdate(id, { event: 'created' });
  queueMicrotask(() => void runProjectBatchJob(id));
  return job;
}

/**
 * 串行执行一个批量任务的各项目。依赖项通过 deps 注入，便于测试脱离 Docker 驱动循环；
 * 生产调用不传 deps，走默认实现。DB 始终是唯一事实来源，广播仅转发轻量变更信号。
 */
export async function runProjectBatchJob(jobId, deps = {}) {
  const {
    findProject = (id) => scannerFindProject(id),
    prepareProjectAction = (project, action) => runnerPrepareProjectAction(project, action),
    updateJobItem = (id, patch) => updateBackgroundJobItem(id, patch),
    updateJob = (id, status, completed) => updateBackgroundJob(id, status, completed),
    recordOperation = (op) => addOperation(op),
    emit = (id, event, payload) => emitJobUpdate(id, { event, ...payload }),
    flushInterval = 250,
  } = deps;

  const job = getBackgroundJob(jobId);
  if (!job) return;
  updateJob(jobId, 'running', 0);
  emit(jobId, 'start', { total: job.items.length });
  let completed = 0;
  let failed = 0;
  for (const item of job.items) {
    let output = '';
    let lastFlush = 0;
    updateJobItem(item.id, { status: 'running' });
    emit(jobId, 'item', { itemId: item.id, status: 'running', completed });
    try {
      const project = await findProject(item.projectId);
      if (!project) throw new Error('项目已不可见');
      const prepared = await prepareProjectAction(project, job.action);
      const code = await prepared.run((type, text) => {
        output += text;
        const now = Date.now();
        if (now - lastFlush > flushInterval) {
          updateJobItem(item.id, { status: 'running', output });
          emit(jobId, 'item', { itemId: item.id, status: 'running', completed });
          lastFlush = now;
        }
      });
      const status = code === 0 ? 'success' : 'failed';
      if (status === 'failed') failed += 1;
      updateJobItem(item.id, { status, output, exitCode: code });
      recordOperation({ projectId: project.id, projectName: project.projectName, action: `${prepared.mode}.${job.action}`, status, detail: output });
    } catch (error) {
      failed += 1;
      output += `${error.message}\n`;
      updateJobItem(item.id, { status: 'failed', output, exitCode: 1 });
      recordOperation({ projectId: item.projectId, projectName: item.projectName, action: `batch.${job.action}`, status: 'failed', detail: output });
    }
    completed += 1;
    updateJob(jobId, 'running', completed);
    emit(jobId, 'progress', { status: 'running', completed });
  }
  const finalStatus = failed ? 'failed' : 'success';
  updateJob(jobId, finalStatus, completed);
  emit(jobId, 'done', { status: finalStatus });
}
