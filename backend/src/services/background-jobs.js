import { randomUUID } from 'crypto';
import {
  addOperation,
  createBackgroundJob,
  getBackgroundJob,
  interruptRunningBackgroundJobs,
  updateBackgroundJob,
  updateBackgroundJobItem,
} from '../lib/db.js';
import { findProject, scanProjects } from './scanner.js';
import { assertProjectActionAllowed, prepareProjectAction } from './project-action-runner.js';

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
  queueMicrotask(() => void runProjectBatchJob(id));
  return job;
}

async function runProjectBatchJob(jobId) {
  const job = getBackgroundJob(jobId);
  if (!job) return;
  updateBackgroundJob(jobId, 'running', 0);
  let completed = 0;
  let failed = 0;
  for (const item of job.items) {
    let output = '';
    let lastFlush = 0;
    updateBackgroundJobItem(item.id, { status: 'running' });
    try {
      const project = await findProject(item.projectId);
      if (!project) throw new Error('项目已不可见');
      const prepared = await prepareProjectAction(project, job.action);
      const code = await prepared.run((type, text) => {
        output += text;
        const now = Date.now();
        if (now - lastFlush > 250) {
          updateBackgroundJobItem(item.id, { status: 'running', output });
          lastFlush = now;
        }
      });
      const status = code === 0 ? 'success' : 'failed';
      if (status === 'failed') failed += 1;
      updateBackgroundJobItem(item.id, { status, output, exitCode: code });
      addOperation({ projectId: project.id, projectName: project.projectName, action: `${prepared.mode}.${job.action}`, status, detail: output });
    } catch (error) {
      failed += 1;
      output += `${error.message}\n`;
      updateBackgroundJobItem(item.id, { status: 'failed', output, exitCode: 1 });
      addOperation({ projectId: item.projectId, projectName: item.projectName, action: `batch.${job.action}`, status: 'failed', detail: output });
    }
    completed += 1;
    updateBackgroundJob(jobId, 'running', completed);
  }
  updateBackgroundJob(jobId, failed ? 'failed' : 'success', completed);
}
