/**
 * Compose 域工具注册(compose.* 生命周期 / 编排 / 日志 / ps)。
 * 由 agent-tools.js 拆分 —— 工具注册链与 helper 逐字节搬运。
 */
import { getActivityDocker } from '../docker-hosts.js';
import { findProject, findProjectContainer, scanProjects } from '../scanner.js';
import { prepareProjectAction } from '../project-action-runner.js';
import { readCompose, saveCompose, spawnComposeCommand } from '../compose-runner.js';
import { runWorkspaceComposeArgs } from '../compose-workspace.js';
import { execReadonly, readContainerLogs } from '../../lib/docker-exec.js';
import { validateComposeSemantics, previewComposeChange } from '../compose-validator.js';
import { assertEnvAccess, readProjectEnv, saveProjectEnv, applyProjectEnv } from '../project-env.js';

function collectOutput() {
  let text = '';
  return {
    push: (stream, chunk) => { text += chunk; },
    text: () => text.slice(-20000),
  };
}
/** 在 mounted / workspace 两种可编辑模式下执行任意 docker compose 参数。 */
async function runComposeArgs(project, args, onOutput = () => {}) {
  const output = collectOutput();
  if (project.mounted) {
    const code = await new Promise((resolve, reject) => {
      const child = spawnComposeCommand(project, args);
      child.stdout.on('data', (chunk) => { onOutput('stdout', chunk.toString('utf8')); output.push('stdout', chunk); });
      child.stderr.on('data', (chunk) => { onOutput('stderr', chunk.toString('utf8')); output.push('stderr', chunk); });
      child.on('error', reject);
      child.on('close', (code) => resolve(code ?? 1));
    });
    return { mode: 'compose', exitCode: code, output: output.text() };
  }
  const code = await runWorkspaceComposeArgs(project, args, (stream, chunk) => {
    onOutput(stream, chunk.toString('utf8'));
    output.push(stream, Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  });
  return { mode: 'workspace', exitCode: code, output: output.text() };
}

export function registerComposeTools(agent) {
  const lifecycleAction = (action) => async (params, context) => {
    const project = context.project;
    const prepared = await prepareProjectAction(project, action);
    const output = collectOutput();
    const exitCode = await prepared.run((stream, chunk) => output.push(stream, chunk));
    return { mode: prepared.mode, action, exitCode, output: output.text() };
  };

  agent
    .registerTool('compose.up', {
      description: '启动 Compose 项目,可指定服务(仅整个项目级启动)',
      category: 'compose',
      requiredPermission: 'managed',
      confirmationRequired: true,
      requiresProject: true,
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: '项目 ID' },
          services: { type: 'array', items: { type: 'string' }, description: '指定服务(可选)' },
        },
        required: ['projectId'],
      },
      execute: lifecycleAction('up'),
    })
    .registerTool('compose.stop', {
      description: '停止 Compose 项目或指定服务',
      category: 'compose',
      requiredPermission: 'managed',
      confirmationRequired: true,
      requiresProject: true,
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: '项目 ID' },
          services: { type: 'array', items: { type: 'string' }, description: '指定服务(可选)' },
        },
        required: ['projectId'],
      },
      execute: lifecycleAction('stop'),
    })
    .registerTool('compose.restart', {
      description: '重启 Compose 项目或指定服务',
      category: 'compose',
      requiredPermission: 'managed',
      confirmationRequired: true,
      requiresProject: true,
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: '项目 ID' },
          services: { type: 'array', items: { type: 'string' }, description: '指定服务(可选)' },
        },
        required: ['projectId'],
      },
      execute: lifecycleAction('restart'),
    })
    .registerTool('compose.pull', {
      description: '拉取项目镜像(需可编辑的 Compose 目录能力)',
      category: 'compose',
      requiredPermission: 'editable',
      confirmationRequired: false,
      requiresProject: true,
      parameters: {
        type: 'object',
        properties: { projectId: { type: 'string', description: '项目 ID' } },
        required: ['projectId'],
      },
      execute: lifecycleAction('pull'),
    })
    .registerTool('compose.logs', {
      description: '读取项目容器最近日志(只读),可按服务过滤与关键词检索',
      category: 'diagnostic',
      requiredPermission: 'managed',
      confirmationRequired: false,
      requiresProject: true,
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: '项目 ID' },
          containerId: { type: 'string', description: '指定容器(可选)' },
          services: { type: 'array', items: { type: 'string' }, description: '指定服务(可选)' },
          tail: { type: 'number', description: '最后 N 行(默认 100)' },
          grep: { type: 'string', description: '搜索关键词(可选)' },
        },
        required: ['projectId'],
      },
      execute: async (params, context) => {
        const tail = Math.min(Math.max(Number(params.tail) || 100, 20), 2000);
        const docker = getActivityDocker();
        let targets = context.project.containers || [];
        if (params.containerId) {
          const match = await findProjectContainer(params.projectId, params.containerId);
          targets = match?.container ? [match.container] : [];
        } else if (Array.isArray(params.services) && params.services.length) {
          const wanted = params.services.map((s) => String(s).toLowerCase());
          targets = targets.filter((c) => wanted.some((s) => c.name.toLowerCase().includes(s)));
        }
        const lines = [];
        for (const item of targets) {
          const logs = await readContainerLogs(docker.getContainer(item.id), tail);
          const needle = params.grep ? String(params.grep) : '';
          const filtered = needle
            ? logs.split('\n').filter((line) => line.includes(needle))
            : logs.split('\n');
          for (const line of filtered) lines.push(`[${item.name}] ${line}`);
        }
        return { containers: targets.map((item) => item.name), logs: lines.slice(-tail).join('\n') };
      },
    })
    .registerTool('compose.ps', {
      description: '列出项目或全部纳管项目的容器状态(只读)',
      category: 'compose',
      requiredPermission: 'managed',
      confirmationRequired: false,
      requiresProject: false,
      parameters: {
        type: 'object',
        properties: { projectId: { type: 'string', description: '项目 ID(可选,缺省返回全部纳管项目)' } },
      },
      execute: async (params, _context) => {
        const projects = await scanProjects();
        const managed = projects.filter((project) => project.managed);
        const scoped = params.projectId ? managed.filter((project) => project.id === params.projectId) : managed;
        return scoped.map((project) => ({
          projectId: project.id,
          projectName: project.projectName,
          status: project.status,
          containers: project.containers.map((c) => ({
            name: c.name,
            state: c.state,
            statusText: c.statusText,
            image: c.image,
          })),
        }));
      },
    })
    .registerTool('compose.scale', {
      description: '调整服务副本数(需可编辑的 Compose 目录能力)',
      category: 'compose',
      requiredPermission: 'editable',
      confirmationRequired: true,
      requiresProject: true,
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: '项目 ID' },
          service: { type: 'string', description: '服务名' },
          replicas: { type: 'number', description: '目标副本数' },
        },
        required: ['projectId', 'service', 'replicas'],
      },
      execute: async (params, context) => {
        const replicas = Math.max(0, Math.min(Math.floor(Number(params.replicas)), 100));
        const service = String(params.service || '').trim();
        if (!service) throw new Error('服务名不能为空');
        const result = await runComposeArgs(context.project, ['up', '-d', '--scale', `${service}=${replicas}`]);
        return { service, replicas, ...result };
      },
    })
    .registerTool('compose.exec', {
      description: '在项目容器内执行命令(会写入容器,需确认)',
      category: 'compose',
      requiredPermission: 'managed',
      confirmationRequired: true,
      requiresProject: true,
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: '项目 ID' },
          containerId: { type: 'string', description: '容器 ID' },
          command: { type: 'string', description: '要执行的命令' },
        },
        required: ['projectId', 'containerId', 'command'],
      },
      execute: async (params, context) => {
        if (!context.container) throw new Error('容器不属于当前项目');
        const command = String(params.command || '').trim();
        if (!command) throw new Error('命令不能为空');

        // 检查 ENABLE_SHELL 全局开关(与 Web Shell 一致的安全边界)
        const enableShell = process.env.ENABLE_SHELL === '1';
        if (!enableShell) {
          throw Object.assign(
            new Error('Shell 执行未启用,设置 ENABLE_SHELL=1 后重启'),
            { statusCode: 403 }
          );
        }

        const docker = getActivityDocker();
        const container = docker.getContainer(context.container.id);
        const started = Date.now();
        const exec = await container.exec({ AttachStdout: true, AttachStderr: true, Cmd: ['/bin/sh', '-c', command] });
        const stream = await exec.start({ Tty: false });
        const chunks = [];
        for await (const chunk of stream) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const inspect = await exec.inspect().catch(() => null);
        return {
          stdout: Buffer.concat(chunks).toString('utf8').slice(0, 20000),
          exitCode: inspect?.ExitCode ?? null,
          durationMs: Date.now() - started,
        };
      },
    });
  return agent;
}
