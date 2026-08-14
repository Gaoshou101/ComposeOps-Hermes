import { spawn } from 'child_process';
import { chmod, chown, readFile, realpath, rename, stat, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { randomBytes } from 'crypto';
import { validateYaml } from '../lib/files.js';
import { addComposeBackup } from '../lib/db.js';

const COMPOSE_BIN = process.env.COMPOSE_BIN || 'docker';
const ACTIONS = {
  up: ['up', '-d'],
  down: ['down'],
  restart: ['restart'],
  pull: ['pull'],
  ps: ['ps'],
};

function composeBase() {
  if (COMPOSE_BIN === 'docker') return ['docker', 'compose'];
  if (COMPOSE_BIN === 'docker-compose') return ['docker-compose'];
  const parts = COMPOSE_BIN.trim().split(/\s+/);
  if (!parts[0]) throw new Error('COMPOSE_BIN 配置无效');
  return parts;
}

export async function resolveProjectFile(project, fileIndex = 0) {
  const index = Number(fileIndex);
  if (!Number.isInteger(index) || index < 0 || index >= project.composeFiles.length) {
    throw Object.assign(new Error('Compose 文件不存在'), { statusCode: 404 });
  }
  const root = await realpath(project.workingDir);
  const expected = await Promise.all(project.composeFiles.map((file) => realpath(file)));
  const selected = expected[index];
  if (!(selected === root || selected.startsWith(`${root}${path.sep}`))) {
    throw Object.assign(new Error('Compose 文件不在项目目录内'), { statusCode: 403 });
  }
  return selected;
}

export function composeArgs(project, action, overrideFiles = null) {
  const actionArgs = ACTIONS[action];
  if (!actionArgs) throw Object.assign(new Error('不支持的 Compose 操作'), { statusCode: 400 });
  const files = overrideFiles || project.composeFiles;
  return [...composeBase().slice(1), ...files.flatMap((file) => ['-f', file]), ...actionArgs];
}

export function spawnCompose(project, action) {
  const base = composeBase();
  return spawn(base[0], composeArgs(project, action), {
    cwd: project.workingDir,
    env: { ...process.env, COMPOSE_HTTP_TIMEOUT: '300', COMPOSE_PROGRESS: 'plain' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function runConfigCheck(project, files) {
  return new Promise((resolve, reject) => {
    const base = composeBase();
    const args = [...base.slice(1), ...files.flatMap((file) => ['-f', file]), 'config', '--quiet'];
    const child = spawn(base[0], args, {
      cwd: project.workingDir,
      env: { ...process.env, COMPOSE_PROGRESS: 'plain' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(Object.assign(new Error(stderr.trim() || `docker compose config 退出码 ${code}`), {
        statusCode: 422,
      }));
    });
  });
}

export async function readCompose(project, fileIndex = 0) {
  const filePath = await resolveProjectFile(project, fileIndex);
  return { fileIndex: Number(fileIndex), path: filePath, content: await readFile(filePath, 'utf8') };
}

export async function saveCompose(project, fileIndex, content, reason = 'save') {
  if (typeof content !== 'string' || content.length === 0 || content.length > 2 * 1024 * 1024) {
    throw Object.assign(new Error('Compose 内容为空或超过 2MB'), { statusCode: 400 });
  }
  validateYaml(content);
  const filePath = await resolveProjectFile(project, fileIndex);
  const previous = await readFile(filePath, 'utf8');
  const currentStat = await stat(filePath);
  const tempPath = path.join(path.dirname(filePath), `.composeops-${randomBytes(8).toString('hex')}.tmp`);
  await writeFile(tempPath, content, { encoding: 'utf8', mode: currentStat.mode });
  try {
    const checkFiles = [...project.composeFiles];
    checkFiles[Number(fileIndex)] = tempPath;
    await runConfigCheck(project, checkFiles);
    addComposeBackup(project.id, filePath, previous, reason);
    await chown(tempPath, currentStat.uid, currentStat.gid).catch(() => {});
    await rename(tempPath, filePath);
    await chmod(filePath, currentStat.mode);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
  return { ok: true, path: filePath };
}

export { ACTIONS };
