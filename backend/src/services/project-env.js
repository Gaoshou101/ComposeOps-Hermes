import { readFile, rename, writeFile, unlink } from 'fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { parseDotenv, serializeDotenv, validateDotenv } from '../lib/dotenv.js';
import { spawnComposeCommand } from './compose-runner.js';
import { withRunner, execInRunner, readArchiveFile, putArchiveFile, runWorkspaceComposeArgs } from './compose-workspace.js';
import { addOperation } from '../lib/db.js';

const ENV_FILE = '.env';
const ENV_EXAMPLE = '.env.example';
const MAX_ENV_BYTES = 256 * 1024;

function projectEnvRoot(project) {
  const root = project.workingDir;
  if (!root || typeof root !== 'string' || !path.posix.isAbsolute(root)) {
    throw Object.assign(new Error('项目工作目录缺失,无法定位 .env'), { statusCode: 409 });
  }
  return path.posix.normalize(root);
}

async function readHostFile(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readContainerFile(container, filePath, { missingOk = false } = {}) {
  try {
    const { content } = await readArchiveFile(container, filePath);
    return content;
  } catch (error) {
    if (missingOk && error.statusCode === 404) return null;
    throw error;
  }
}

/** 读取项目 .env + .env.example,返回结构化数据。 */
export async function readProjectEnv(project) {
  if (!project) throw Object.assign(new Error('项目不存在'), { statusCode: 404 });
  const root = projectEnvRoot(project);
  const envPath = path.posix.join(root, ENV_FILE);
  const examplePath = path.posix.join(root, ENV_EXAMPLE);

  if (project.mounted) {
    const raw = await readHostFile(envPath);
    const exampleRaw = await readHostFile(examplePath);
    return buildEnvPayload({ envPath, examplePath, raw, exampleRaw });
  }
  if (!project.editable || !project.workspaceAvailable) {
    throw Object.assign(new Error('项目未启用 Compose 目录能力,无法读取环境变量'), { statusCode: 403 });
  }
  return withRunner(project, async (container) => {
    const raw = await readContainerFile(container, envPath, { missingOk: true });
    const exampleRaw = await readContainerFile(container, examplePath, { missingOk: true });
    return buildEnvPayload({ envPath, examplePath, raw, exampleRaw });
  });
}

function buildEnvPayload({ envPath, examplePath, raw, exampleRaw }) {
  return {
    path: envPath,
    examplePath,
    exists: raw != null,
    raw: raw ?? '',
    exampleRaw: exampleRaw ?? '',
    entries: parseDotenv(raw ?? ''),
    template: parseDotenv(exampleRaw ?? ''),
    exampleExists: exampleRaw != null,
  };
}

/** 把结构化条目合并为 raw(表格模式保存时使用)。 */
export function buildRawFromEntries(entries) {
  return serializeDotenv(entries);
}

/**
 * 保存 .env:先校验,再在项目根生成 .env.backup.<ts>,原子替换。
 * @param {object} project
 * @param {string} raw  新内容(优先)或 entries 生成
 * @param {Array} [entries]
 */
export async function saveProjectEnv(project, { raw, entries }) {
  if (!project) throw Object.assign(new Error('项目不存在'), { statusCode: 404 });
  const content = raw != null ? raw : buildRawFromEntries(entries || []);
  if (typeof content !== 'string' || content.length > MAX_ENV_BYTES) {
    throw Object.assign(new Error('环境变量内容为空或超过 256KB'), { statusCode: 400 });
  }
  const validation = validateDotenv(content);
  if (!validation.ok) {
    throw Object.assign(new Error(validation.errors.join('; ')), { statusCode: 422 });
  }
  const root = projectEnvRoot(project);
  const envPath = path.posix.join(root, ENV_FILE);
  const backupName = `.env.backup.${Date.now()}.${randomBytes(3).toString('hex')}`;
  const backupPath = path.posix.join(root, backupName);

  if (project.mounted) {
    const previous = await readHostFile(envPath) ?? '';
    const tempPath = `${envPath}.tmp.${randomBytes(4).toString('hex')}`;
    try {
      await writeFile(backupPath, previous, 'utf8');
      await writeFile(tempPath, content, 'utf8');
      await rename(tempPath, envPath);
    } catch (error) {
      await unlink(tempPath).catch(() => {});
      throw Object.assign(new Error(`写入 .env 失败:${error.message}`), { statusCode: 500 });
    }
    addOperation({ projectId: project.id, projectName: project.projectName, action: 'env.save', status: 'success', detail: backupName });
    return { ok: true, path: envPath, backup: backupName };
  }
  // workspace 容器模式:在容器内读旧内容 → 写备份文件 → 写 .env
  return withRunner(project, async (container) => {
    const previous = await readContainerFile(container, envPath, { missingOk: true }) ?? '';
    // 备份文件写在项目根(容器内与宿主机同路径绑定)
    await putArchiveFile(container, root, backupName, previous, { mode: 0o600, uid: 0, gid: 0 });
    try {
      await putArchiveFile(container, root, ENV_FILE, content, { mode: 0o600, uid: 0, gid: 0 });
    } catch (error) {
      await execInRunner(container, ['rm', '-f', '--', backupPath]).catch(() => {});
      throw Object.assign(new Error(`写入 .env 失败:${error.message}`), { statusCode: 500 });
    }
    addOperation({ projectId: project.id, projectName: project.projectName, action: 'env.save', status: 'success', detail: backupName });
    return { ok: true, path: envPath, backup: backupName };
  });
}


/**
 * 触发 .env 生效:执行 docker compose up -d --force-recreate。
 * 返回 Promise<number>(退出码),onOutput 流式回调。
 */
export async function applyProjectEnv(project, { onOutput = () => {}, onChild = () => {} } = {}) {
  if (!project) throw Object.assign(new Error('项目不存在'), { statusCode: 404 });
  if (project.mounted) {
    return new Promise((resolve, reject) => {
      const child = spawnComposeCommand(project, ['up', '-d', '--force-recreate']);
      onChild(child);
      child.stdout.on('data', (chunk) => onOutput('stdout', chunk.toString('utf8')));
      child.stderr.on('data', (chunk) => onOutput('stderr', chunk.toString('utf8')));
      child.on('error', reject);
      child.on('close', (code) => resolve(code ?? 1));
    });
  }
  return runWorkspaceComposeArgs(project, ['up', '-d', '--force-recreate'], onOutput);
}

/** 供项目 action 校验复用:env.apply 需要 editable。 */
export function assertEnvAccess(project) {
  if (!project?.managed) throw Object.assign(new Error('项目尚未加入管理'), { statusCode: 403 });
  if (!project.editable) {
    throw Object.assign(new Error('Compose 项目路径缺失或权限范围过宽,无法安全读写环境变量'), { statusCode: 403 });
  }
}
