import { ACTIONS, resolveProjectFile, spawnCompose } from './compose-runner.js';
import { runWorkspaceCompose } from './compose-workspace.js';
import { runContainerAction, supportsContainerAction } from './project-control.js';

export function assertProjectActionAllowed(project, action) {
  if (!Object.hasOwn(ACTIONS, action)) {
    throw Object.assign(new Error('不支持的项目操作'), { statusCode: 400 });
  }
  if (!project.managed) throw Object.assign(new Error('项目尚未加入管理'), { statusCode: 403 });
  if (!project.mountEnabled && !supportsContainerAction(action)) {
    throw Object.assign(new Error('尚未为该项目启用 Compose 目录能力'), { statusCode: 403 });
  }
  if (project.mountEnabled && !project.editable && !supportsContainerAction(action)) {
    throw Object.assign(new Error('Compose 项目路径缺失或权限范围过宽，无法安全挂载'), { statusCode: 409 });
  }
}

export async function prepareProjectAction(project, action) {
  assertProjectActionAllowed(project, action);
  if (project.editable && project.mounted) {
    const safeFiles = await Promise.all(project.composeFiles.map((_, index) => resolveProjectFile(project, index)));
    return {
      mode: 'compose',
      run(onOutput = () => {}, onChild = () => {}) {
        return new Promise((resolve, reject) => {
          const child = spawnCompose({ ...project, composeFiles: safeFiles }, action);
          onChild(child);
          child.stdout.on('data', (chunk) => onOutput('stdout', chunk.toString('utf8')));
          child.stderr.on('data', (chunk) => onOutput('stderr', chunk.toString('utf8')));
          child.on('error', reject);
          child.on('close', (code) => resolve(code ?? 1));
        });
      },
    };
  }
  if (project.editable) {
    return { mode: 'workspace', run: (onOutput = () => {}) => runWorkspaceCompose(project, action, onOutput) };
  }
  return { mode: 'containers', run: (onOutput = () => {}) => runContainerAction(project, action, onOutput) };
}
