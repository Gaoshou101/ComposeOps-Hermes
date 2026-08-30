import { execFile } from 'node:child_process';
import { getActivityDocker } from './docker-hosts.js';

function execJson(args) {
  return new Promise((resolve, reject) => {
    execFile('docker', args, { timeout: 20000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error) { reject(Object.assign(new Error(`docker 命令失败:${error.message}`), { statusCode: 502 })); return; }
      try { resolve(JSON.parse(stdout)); } catch (e) { reject(Object.assign(new Error('解析 docker system df 失败'), { statusCode: 502 })); }
    });
  });
}

/** 解析 docker system df --format json 为结构化统计(纯输出,便于单测)。 */
export function parseDockerDf(data = {}) {
  const imagesTotal = sum(data.Images, 'Size') || 0;
  const imagesReclaimable = sum((data.Images || []).filter((item) => Number(item.Containers) <= 0), 'Size');
  const containersTotal = sum(data.Containers, 'SizeRw') || 0;
  const containersReclaimable = sum((data.Containers || []).filter((item) => item.State !== 'running'), 'SizeRw');
  const volumes = (data.Volumes || []).map((volume) => ({
    name: volume.Name || '',
    size: Number(volume.UsageData?.Size) || 0,
    refCount: Number(volume.UsageData?.RefCount) || 0,
    orphan: !(Number(volume.UsageData?.RefCount) > 0),
  }));
  const volumesTotal = sum(volumes, 'size');
  const volumesReclaimable = sum(volumes.filter((volume) => volume.orphan), 'size');
  const buildCache = (data.BuildCache || []).map((cache) => ({
    id: cache.ID || '',
    size: Number(cache.Size) || 0,
    inUse: !!cache.InUse,
  }));
  const buildCacheTotal = sum(buildCache, 'size');
  const buildCacheReclaimable = sum(buildCache.filter((cache) => !cache.inUse), 'size');
  const total = imagesTotal + containersTotal + volumesTotal + buildCacheTotal;
  const reclaimable = imagesReclaimable + containersReclaimable + volumesReclaimable + buildCacheReclaimable;
  return {
    images: { count: data.Images?.length || 0, total: imagesTotal, reclaimable: imagesReclaimable },
    containers: { count: data.Containers?.length || 0, total: containersTotal, reclaimable: containersReclaimable },
    volumes: { count: volumes.length, total: volumesTotal, reclaimable: volumesReclaimable, orphans: volumes.filter((v) => v.orphan).length },
    buildCache: { count: buildCache.length, total: buildCacheTotal, reclaimable: buildCacheReclaimable },
    total,
    reclaimable,
  };
}

function sum(items, key) {
  return (items || []).reduce((total, item) => total + (Number(item?.[key]) || 0), 0);
}

/** GET /api/system/storage/df:调用 docker system df --format json。 */
export async function getSystemStorageDf() {
  const data = await execJson(['system', 'df', '--format', 'json']);
  const parsed = parseDockerDf(data);
  // 磁盘剩余估算(df 总可用)
  let disk = null;
  try {
    const df = await new Promise((resolve, reject) => {
      execFile('df', ['-B1', '/'], { timeout: 5000 }, (error, stdout) => {
        if (error) return reject(error);
        const line = String(stdout).split('\n')[1] || '';
        const parts = line.trim().split(/\s+/);
        resolve(parts.length >= 4 ? { total: Number(parts[1]) || 0, used: Number(parts[2]) || 0, free: Number(parts[3]) || 0 } : null);
      });
    });
    disk = { mount: '/', total: df.total, used: df.used, free: df.free };
  } catch {}
  return { ...parsed, disk, checkedAt: Date.now() };
}

/**
 * 分级清理:
 * - safe:悬空镜像(dangling)、不再使用且非 running 的容器、未被引用的 build cache
 * - builder:全部构建缓存
 * - volumes:孤儿持久卷
 * - all:safe + volumes + builder
 * 返回释放字节数。
 */
export async function pruneStorage(mode = 'safe') {
  const docker = getActivityDocker();
  const reclaimed = { images: 0, containers: 0, volumes: 0, buildCache: 0 };
  if (mode === 'safe' || mode === 'all') {
    const images = await docker.pruneImages({ filters: { dangling: ['true'] } });
    reclaimed.images = sumBytes(images?.SpaceReclaimed);
    const containers = await docker.pruneContainers({ filters: { status: ['exited'] } });
    reclaimed.containers = sumBytes(containers?.SpaceReclaimed);
  }
  if (mode === 'builder' || mode === 'all') {
    const builder = await docker.pruneBuilds({ filters: { inUse: ['false'] } });
    reclaimed.buildCache = sumBytes(builder?.SpaceReclaimed);
  }
  if (mode === 'volumes' || mode === 'all') {
    const volumes = await docker.pruneVolumes({});
    reclaimed.volumes = sumBytes(volumes?.SpaceReclaimed);
  }
  const reusedTotal = Object.values(reclaimed).reduce((total, v) => total + v, 0);
  return { mode, reclaimedMB: Math.round((reusedTotal / 1024 / 1024) * 10) / 10, reclaimed };
}

function sumBytes(value) {
  return Number(value) || 0;
}
