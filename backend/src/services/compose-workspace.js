import path from 'node:path';
import { randomBytes } from 'node:crypto';
import tar from 'tar-stream';
import docker from './docker.js';
import { ACTIONS } from './compose-runner.js';
import { demuxStream } from '../lib/docker-streams.js';
import { validateYaml } from '../lib/files.js';
import { addComposeBackup } from '../lib/db.js';
import { safeProjectMountPath } from './mount-plan.js';

let runnerImagePromise;
const workspaceRunners = new Map();
const workspaceIdleMs = boundedNumber(process.env.COMPOSEOPS_WORKSPACE_IDLE_MS, 90_000, 5_000, 15 * 60_000);
const workspaceCacheMax = boundedNumber(process.env.COMPOSEOPS_WORKSPACE_CACHE_MAX, 8, 1, 64);

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(parsed, max)) : fallback;
}

function projectPaths(project) {
  const root = safeProjectMountPath(project.workingDir);
  if (!root) throw Object.assign(new Error('项目工作目录过宽、缺失或不是安全的绝对路径'), { statusCode: 409 });
  const files = (project.composeFiles || []).map((file) => path.posix.normalize(file));
  if (!files.length || files.some((file) => !path.posix.isAbsolute(file) ||
      (file !== root && !file.startsWith(`${root}/`)))) {
    throw Object.assign(new Error('Compose 文件不在项目工作目录内'), { statusCode: 403 });
  }
  return { root, files };
}

async function runnerImage() {
  if (process.env.COMPOSEOPS_RUNNER_IMAGE) return process.env.COMPOSEOPS_RUNNER_IMAGE;
  if (!runnerImagePromise) {
    runnerImagePromise = docker.getContainer(process.env.HOSTNAME || '').inspect()
      .then((inspection) => inspection.Config?.Image)
      .then((image) => {
        if (!image) throw new Error('无法识别 ComposeOps 当前镜像');
        return image;
      });
  }
  return runnerImagePromise;
}

async function createRunner(project) {
  const { root } = projectPaths(project);
  const container = await docker.createContainer({
    Image: await runnerImage(),
    // AutoRemove 是异常退出的兜底；正常情况下由空闲计时器提前清理。
    Cmd: ['sleep', '3600'],
    WorkingDir: root,
    Labels: { 'composeops.helper': 'compose-workspace', 'composeops.project': project.id },
    HostConfig: {
      AutoRemove: true,
      Mounts: [
        { Type: 'bind', Source: root, Target: root, ReadOnly: false },
        { Type: 'bind', Source: '/var/run/docker.sock', Target: '/var/run/docker.sock', ReadOnly: false },
      ],
      SecurityOpt: ['no-new-privileges:true'],
    },
  });
  await container.start();
  return container;
}

function runnerKey(project) {
  return `${project.id}\0${projectPaths(project).root}`;
}

function retireRunner(entry) {
  if (entry.retired) return;
  entry.retired = true;
  clearTimeout(entry.idleTimer);
  if (workspaceRunners.get(entry.key) === entry) workspaceRunners.delete(entry.key);
}

async function destroyRunner(entry) {
  if (entry.destroyPromise) return entry.destroyPromise;
  entry.destroyPromise = (async () => {
    const container = await entry.containerPromise.catch(() => null);
    if (!container) return;
    await container.remove({ force: true }).catch(() => {});
  })();
  return entry.destroyPromise;
}

function scheduleRunnerCleanup(entry) {
  clearTimeout(entry.idleTimer);
  if (entry.active > 0) return;
  if (entry.retired) {
    void destroyRunner(entry);
    return;
  }
  entry.idleTimer = setTimeout(() => {
    retireRunner(entry);
    if (entry.active === 0) void destroyRunner(entry);
  }, workspaceIdleMs);
  entry.idleTimer.unref?.();
}

function releaseRunner(entry) {
  entry.active = Math.max(0, entry.active - 1);
  entry.lastUsedAt = Date.now();
  scheduleRunnerCleanup(entry);
}

function trimRunnerCache() {
  if (workspaceRunners.size < workspaceCacheMax) return;
  const idle = [...workspaceRunners.values()]
    .filter((entry) => entry.active === 0)
    .sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  while (workspaceRunners.size >= workspaceCacheMax && idle.length) {
    const entry = idle.shift();
    retireRunner(entry);
    void destroyRunner(entry);
  }
}

function createRunnerEntry(project, key) {
  trimRunnerCache();
  const entry = {
    key,
    projectId: project.id,
    root: projectPaths(project).root,
    active: 0,
    lastUsedAt: Date.now(),
    idleTimer: null,
    retired: false,
    destroyPromise: null,
    containerPromise: createRunner(project),
  };
  // 创建失败时立即移出缓存，下一次请求可以重新创建。
  entry.containerPromise.catch(() => retireRunner(entry));
  workspaceRunners.set(key, entry);
  return entry;
}

async function acquireRunner(project) {
  const key = runnerKey(project);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let entry = workspaceRunners.get(key);
    const reused = !!entry;
    if (!entry || entry.retired) entry = createRunnerEntry(project, key);
    clearTimeout(entry.idleTimer);
    entry.active += 1;
    try {
      const container = await entry.containerPromise;
      if (reused) {
        const inspection = await container.inspect();
        if (!inspection.State?.Running) throw new Error('Compose 工作容器已经失效');
      }
      return { entry, container };
    } catch (error) {
      retireRunner(entry);
      releaseRunner(entry);
      if (attempt === 1) throw error;
    }
  }
  throw new Error('无法创建 Compose 工作容器');
}

async function withRunner(project, callback) {
  let lease;
  try {
    lease = await acquireRunner(project);
    return await callback(lease.container);
  } catch (error) {
    if (!error.statusCode) error.statusCode = 409;
    throw error;
  } finally {
    if (lease) releaseRunner(lease.entry);
  }
}

export { withRunner, execInRunner, readArchiveFile, putArchiveFile };

export function pruneWorkspaceRunners(allowedProjectIds = []) {
  const allowed = new Set(allowedProjectIds);
  for (const entry of workspaceRunners.values()) {
    if (allowed.has(entry.projectId)) continue;
    retireRunner(entry);
    if (entry.active === 0) void destroyRunner(entry);
  }
}

export async function closeAllWorkspaceRunners() {
  const entries = [...workspaceRunners.values()];
  for (const entry of entries) retireRunner(entry);
  await Promise.all(entries.map((entry) => destroyRunner(entry)));
}

export function workspaceRunnerStats() {
  return {
    idleMs: workspaceIdleMs,
    maxEntries: workspaceCacheMax,
    entries: [...workspaceRunners.values()].map((entry) => ({
      projectId: entry.projectId,
      active: entry.active,
      retired: entry.retired,
    })),
  };
}

async function execInRunner(container, cmd, { input, onOutput = () => {} } = {}) {
  const instance = await container.exec({
    Cmd: cmd,
    AttachStdin: input !== undefined,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
    Env: ['COMPOSE_HTTP_TIMEOUT=300', 'COMPOSE_PROGRESS=plain'],
  });
  const stream = await instance.start({ hijack: input !== undefined, stdin: input !== undefined });
  const demux = demuxStream();
  stream.pipe(demux);
  const stdout = [];
  const stderr = [];
  demux.stdout.on('data', (chunk) => { stdout.push(chunk); onOutput('stdout', chunk.toString('utf8')); });
  demux.stderr.on('data', (chunk) => { stderr.push(chunk); onOutput('stderr', chunk.toString('utf8')); });
  if (input !== undefined) stream.end(input);
  await Promise.all([
    new Promise((resolve, reject) => demux.stdout.on('end', resolve).on('error', reject)),
    new Promise((resolve, reject) => demux.stderr.on('end', resolve).on('error', reject)),
  ]);
  const result = await instance.inspect();
  return {
    code: result.ExitCode ?? 1,
    stdout: Buffer.concat(stdout).toString('utf8'),
    stderr: Buffer.concat(stderr).toString('utf8'),
  };
}

async function readArchiveFile(container, filePath) {
  const archive = await container.getArchive({ path: filePath });
  const extract = tar.extract();
  return new Promise((resolve, reject) => {
    let result = null;
    extract.on('entry', (header, stream, next) => {
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => {
        if (!result && header.type === 'file') {
          result = { content: Buffer.concat(chunks).toString('utf8'), header };
        }
        next();
      });
      stream.on('error', reject);
      stream.resume();
    });
    extract.on('finish', () => {
      if (result) resolve(result);
      else reject(Object.assign(new Error('Compose 文件不存在'), { statusCode: 404 }));
    });
    extract.on('error', reject);
    archive.on('error', reject);
    archive.pipe(extract);
  });
}

async function putArchiveFile(container, directory, name, content, header) {
  const pack = tar.pack();
  pack.entry({
    name,
    type: 'file',
    mode: header.mode,
    uid: header.uid,
    gid: header.gid,
    size: Buffer.byteLength(content),
  }, content);
  pack.finalize();
  await container.putArchive(pack, { path: directory });
}

function selectedFile(project, fileIndex) {
  const { files } = projectPaths(project);
  const index = Number(fileIndex);
  if (!Number.isInteger(index) || index < 0 || index >= files.length) {
    throw Object.assign(new Error('Compose 文件不存在'), { statusCode: 404 });
  }
  return { index, filePath: files[index], files };
}

export async function readWorkspaceCompose(project, fileIndex = 0) {
  const { index, filePath } = selectedFile(project, fileIndex);
  return withRunner(project, async (container) => {
    const { content } = await readArchiveFile(container, filePath);
    return { fileIndex: index, path: filePath, content };
  });
}

export async function saveWorkspaceCompose(project, fileIndex, content, reason = 'save') {
  if (typeof content !== 'string' || content.length === 0 || content.length > 2 * 1024 * 1024) {
    throw Object.assign(new Error('Compose 内容为空或超过 2MB'), { statusCode: 400 });
  }
  validateYaml(content);
  const { index, filePath, files } = selectedFile(project, fileIndex);
  return withRunner(project, async (container) => {
    const previous = await readArchiveFile(container, filePath);
    const tempName = `.composeops-${randomBytes(8).toString('hex')}.tmp`;
    const tempPath = path.posix.join(path.posix.dirname(filePath), tempName);
    await putArchiveFile(container, path.posix.dirname(filePath), tempName, content, previous.header);
    try {
      const checkFiles = [...files];
      checkFiles[index] = tempPath;
      const check = await execInRunner(container, ['docker', 'compose', ...checkFiles.flatMap((file) => ['-f', file]), 'config', '--quiet']);
      if (check.code !== 0) throw Object.assign(new Error(check.stderr.trim() || `docker compose config 退出码 ${check.code}`), { statusCode: 422 });
      addComposeBackup(project.id, filePath, previous.content, reason);
      const move = await execInRunner(container, ['mv', '-f', '--', tempPath, filePath]);
      if (move.code !== 0) throw new Error(move.stderr.trim() || 'Compose 文件替换失败');
      await execInRunner(container, ['chmod', previous.header.mode.toString(8), filePath]).catch(() => {});
      await execInRunner(container, ['chown', `${previous.header.uid}:${previous.header.gid}`, filePath]).catch(() => {});
    } catch (error) {
      await execInRunner(container, ['rm', '-f', '--', tempPath]).catch(() => {});
      throw error;
    }
    return { ok: true, path: filePath };
  });
}

export async function runWorkspaceComposeArgs(project, args, onOutput = () => {}) {
  const { files } = projectPaths(project);
  if (!Array.isArray(args) || !args.length) throw Object.assign(new Error('无效的 Compose 参数'), { statusCode: 400 });
  return withRunner(project, async (container) => {
    const result = await execInRunner(container, ['docker', 'compose', ...files.flatMap((file) => ['-f', file]), ...args], { onOutput });
    return result.code;
  });
}

export async function runWorkspaceCompose(project, action, onOutput = () => {}) {
  const { files } = projectPaths(project);
  const actionArgs = ACTIONS[action];
  if (!actionArgs) throw Object.assign(new Error('不支持的 Compose 操作'), { statusCode: 400 });
  return withRunner(project, async (container) => {
    const result = await execInRunner(container, ['docker', 'compose', ...files.flatMap((file) => ['-f', file]), ...actionArgs], { onOutput });
    return result.code;
  });
}
