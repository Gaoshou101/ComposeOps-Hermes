/**
 * 数据卷备份:用一次性 helper 容器(busybox)把项目的命名卷打包为 tar.gz。
 *
 * - 备份目录:setting 'backup.volume_dir',默认 <backend/data>/volume-backups;
 *   该路径始终解析在**当前激活 Docker 宿主**的文件系统上(远程 SSH/TCP 宿主同理)。
 * - 仅备份命名卷(compose 顶层 volumes / 服务引用的命名卷);bind mount 与
 *   变量引用会被跳过并在结果里注明原因。
 * - 恢复 = helper 容器反向 untar(覆盖卷内容,路由层必须先经用户确认)。
 * - 每个卷保留最近 20 份,与 compose 文件备份策略一致。
 */

import { mkdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { getActivityDocker, getActiveHost } from './docker-hosts.js';
import { readCompose } from './compose-runner.js';
import { demuxStream } from '../lib/docker-streams.js';
import { getSetting, addOperation, addVolumeBackup, listVolumeBackups, getVolumeBackup, deleteVolumeBackupRow, pruneVolumeBackups } from '../lib/db.js';

const HELPER_IMAGE = 'busybox:1.36';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function getBackupDir() {
  return getSetting('backup.volume_dir', '') || path.join(__dirname, '../../data/volume-backups');
}

/**
 * 从 Compose 内容解析"值得备份"的命名卷(纯函数,便于单测)。
 * 返回 [{ name, external, skip }] —— skip 非空表示该引用不会纳入备份及原因。
 */
export function parseProjectVolumes(composeContent) {
  let doc;
  try {
    doc = parseYaml(String(composeContent || ''));
  } catch {
    return { volumes: [], error: 'compose 文件不是合法 YAML' };
  }
  if (!doc || typeof doc !== 'object') return { volumes: [], error: '' };
  const topVolumes = doc.volumes && typeof doc.volumes === 'object' ? doc.volumes : {};
  const merged = new Map();
  for (const [name, def] of Object.entries(topVolumes)) {
    merged.set(name, { name, external: !!(def && typeof def === 'object' && def.external), skip: '' });
  }
  const services = doc.services && typeof doc.services === 'object' ? doc.services : {};
  for (const [serviceName, service] of Object.entries(services)) {
    const mounts = Array.isArray(service?.volumes) ? service.volumes : [];
    for (const mount of mounts) {
      const isString = typeof mount === 'string';
      const source = isString ? String(mount).split(':')[0] : String(mount?.source || '');
      const type = isString ? '' : String(mount?.type || '');
      if (!source) continue;
      if (!isString && type === 'bind' || source.startsWith('.') || source.startsWith('/') || source.startsWith('~')) {
        merged.set(source, { name: source, external: false, skip: `bind mount(${serviceName})不纳入备份` });
        continue;
      }
      if (!isString && (type === 'tmpfs' || type === 'npipe')) {
        merged.set(source, { name: source, external: false, skip: `${type}挂载(${serviceName})不纳入备份` });
        continue;
      }
      if (source.startsWith('$')) {
        merged.set(source, { name: source, external: false, skip: `变量引用(${serviceName})无法解析` });
        continue;
      }
      if (merged.has(source)) continue;
      merged.set(source, { name: source, external: false, skip: '' });
    }
  }
  return { volumes: [...merged.values()], error: '' };
}

/** 列出项目可备份卷:解析 compose + 校验卷在当前宿主上存在。 */
export async function listProjectVolumes(project) {
  const compose = await readCompose(project);
  const { volumes, error } = parseProjectVolumes(compose.content);
  if (error) throw Object.assign(new Error(error), { statusCode: 400 });
  const docker = getActivityDocker();
  const existing = new Set();
  try {
    const all = await docker.listVolumes();
    for (const volume of all?.Volumes || all || []) existing.add(volume.Name);
  } catch {}
  return volumes.map((item) => ({
    ...item,
    exists: item.skip ? null : existing.has(item.name),
  }));
}

function safeFileName(projectName, volume, timestamp = Date.now()) {
  const clean = (value) => String(value || 'x').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
  return `${clean(projectName)}_${clean(volume)}_${timestamp}.tar.gz`;
}

async function ensureHelperImage(docker) {
  try {
    await docker.getImage(HELPER_IMAGE).inspect();
    return;
  } catch {}
  const stream = await docker.pull(HELPER_IMAGE);
  await new Promise((resolve, reject) => {
    docker.modem.followProgress(stream, (error) => (error ? reject(error) : resolve()));
  });
}

/** 跑一次性 helper 容器执行命令,返回 { exitCode, output }。 */
async function runHelper(docker, cmd, binds) {
  await ensureHelperImage(docker);
  const container = await docker.createContainer({
    Image: HELPER_IMAGE,
    Cmd: ['sh', '-c', cmd],
    HostConfig: { Binds: binds },
    Labels: { 'composeops.role': 'volume-backup' },
  });
  try {
    await container.start();
    const wait = await container.wait();
    const logStream = await container.logs({ stdout: true, stderr: true, follow: false });
    const demux = demuxStream();
    let output = '';
    demux.stdout.on('data', (chunk) => { output += chunk.toString(); });
    demux.stderr.on('data', (chunk) => { output += chunk.toString(); });
    logStream.pipe(demux);
    await new Promise((resolve) => {
      demux.on('end', resolve);
      setTimeout(resolve, 5000);
    });
    return { exitCode: wait.StatusCode ?? wait, output: output.trim() };
  } finally {
    await container.remove({ force: true }).catch(() => {});
  }
}

function volumeBinds(volume, mode) {
  return [`${volume}:/src:${mode}`, `${getBackupDir()}:/backup`];
}

/** 备份单个命名卷,返回新纪录。 */
export async function createVolumeBackup(project, volumeName) {
  if (!volumeName || /[^\w.-]/.test(volumeName)) {
    throw Object.assign(new Error('卷名不合法'), { statusCode: 400 });
  }
  const docker = getActivityDocker();
  const host = getActiveHost();
  const hostId = host?.id || 'local';
  const dir = getBackupDir();
  if (hostId === 'local') await mkdir(dir, { recursive: true });
  const file = safeFileName(project.projectName, volumeName);
  const started = Date.now();
  const { exitCode, output } = await runHelper(
    docker,
    `tar czf "/backup/${file}" -C /src . && du -b "/backup/${file}" | cut -f1`,
    volumeBinds(volumeName, 'ro'),
  ).catch((error) => {
    throw Object.assign(new Error(`helper 容器执行失败:${error.message}`), { statusCode: 502 });
  });
  if (exitCode !== 0) {
    throw Object.assign(new Error(`卷备份失败(exit ${exitCode}):${output.slice(0, 200)}`), { statusCode: 502 });
  }
  let bytes = Number(output.split('\n').pop()) || 0;
  if (!bytes && hostId === 'local') {
    bytes = (await stat(path.join(dir, file)).catch(() => null))?.size || 0;
  }
  const id = addVolumeBackup({ projectId: project.id, projectName: project.projectName, volume: volumeName, file, bytes, host: hostId });
  addOperation({ action: 'volume.backup', status: 'success', detail: `${project.projectName}/${volumeName} → ${file}` });
  // 清理同卷超限的旧备份(记录+文件)
  for (const stale of pruneVolumeBackups(project.id, volumeName)) {
    await removeBackupFile(stale.file).catch(() => {});
    deleteVolumeBackupRow(stale.id);
  }
  return { id, file, bytes, durationMs: Date.now() - started };
}

async function removeBackupFile(file) {
  const docker = getActivityDocker();
  await runHelper(docker, `rm -f "/backup/${file}"`, [`${getBackupDir()}:/backup`]);
}

/** 恢复:把备份 tar 解回卷(覆盖现有内容)。 */
export async function restoreVolumeBackup(id) {
  const record = getVolumeBackup(id);
  if (!record) throw Object.assign(new Error('备份记录不存在'), { statusCode: 404 });
  const docker = getActivityDocker();
  const { exitCode, output } = await runHelper(
    docker,
    `tar xzf "/backup/${record.file}" -C /src`,
    volumeBinds(record.volume, 'rw'),
  ).catch((error) => {
    throw Object.assign(new Error(`helper 容器执行失败:${error.message}`), { statusCode: 502 });
  });
  if (exitCode !== 0) {
    throw Object.assign(new Error(`卷恢复失败(exit ${exitCode}):${output.slice(0, 200)}`), { statusCode: 502 });
  }
  addOperation({ action: 'volume.restore', status: 'success', detail: `${record.projectName}/${record.volume} ← ${record.file}` });
  return { ok: true, volume: record.volume };
}

export async function deleteVolumeBackup(id) {
  const record = getVolumeBackup(id);
  if (!record) throw Object.assign(new Error('备份记录不存在'), { statusCode: 404 });
  await removeBackupFile(record.file).catch(() => {});
  deleteVolumeBackupRow(id);
  addOperation({ action: 'volume.backup.delete', status: 'success', detail: `${record.projectName}/${record.volume} × ${record.file}` });
  return { ok: true };
}

export async function listBackups(projectId = '') {
  return listVolumeBackups(projectId);
}

/** 下载备份文件(仅本地宿主;远程宿主的文件在远端文件系统上)。 */
export async function openBackupStream(id) {
  const record = getVolumeBackup(id);
  if (!record) throw Object.assign(new Error('备份记录不存在'), { statusCode: 404 });
  const host = getActiveHost();
  if ((host?.id || 'local') !== 'local' && host?.type !== 'local') {
    throw Object.assign(new Error('远程宿主上的备份不支持浏览器下载,请在宿主机上直接取用'), { statusCode: 400 });
  }
  const target = path.join(getBackupDir(), record.file);
  const info = await stat(target).catch(() => null);
  if (!info) throw Object.assign(new Error('备份文件已不存在(可能被清理)'), { statusCode: 410 });
  return { stream: createReadStream(target), fileName: record.file, bytes: info.size };
}
