import docker from './docker.js';
import { scanProjects } from './scanner.js';
import { sendNotification } from './notifications.js';
import { setSetting } from '../lib/db.js';

function sum(items, key) {
  return (items || []).reduce((total, item) => total + (Number(item?.[key]) || 0), 0);
}

export async function getDockerUsage() {
  const data = await docker.df();
  const imagesTotal = sum(data.Images, 'Size');
  const imagesReclaimable = sum((data.Images || []).filter((item) => Number(item.Containers) <= 0), 'Size');
  const containersReclaimable = sum((data.Containers || []).filter((item) => item.State !== 'running'), 'SizeRw');
  const buildCacheTotal = sum(data.BuildCache, 'Size');
  const buildCacheReclaimable = sum((data.BuildCache || []).filter((item) => !item.InUse), 'Size');
  const unusedVolumes = (data.Volumes || []).filter((item) => Number(item.UsageData?.RefCount) <= 0);
  const volumesReclaimable = unusedVolumes
    .reduce((total, item) => total + (Number(item.UsageData?.Size) || 0), 0);
  return {
    images: { count: data.Images?.length || 0, total: imagesTotal, reclaimable: imagesReclaimable },
    containers: { count: data.Containers?.length || 0, reclaimable: containersReclaimable },
    buildCache: { count: data.BuildCache?.length || 0, total: buildCacheTotal, reclaimable: buildCacheReclaimable },
    volumes: { count: unusedVolumes.length, reclaimable: volumesReclaimable },
    total: imagesTotal + buildCacheTotal,
    reclaimable: imagesReclaimable + containersReclaimable + buildCacheReclaimable + volumesReclaimable,
  };
}

async function imageId(image) {
  try { return (await docker.getImage(image).inspect()).Id; } catch { return null; }
}

export async function checkImageUpdates(onProgress = () => {}) {
  const projects = await scanProjects();
  const images = [...new Set(projects
    .filter((project) => project.managed)
    .flatMap((project) => project.containers.map((item) => item.image))
    .filter(Boolean))];
  const results = [];
  for (const image of images) {
    const before = await imageId(image);
    onProgress(`拉取 ${image}`);
    try {
      const stream = await docker.pull(image);
      await new Promise((resolve, reject) => {
        docker.modem.followProgress(stream, (error) => error ? reject(error) : resolve());
      });
      const after = await imageId(image);
      results.push({ image, status: before && after && before !== after ? 'updated' : 'current', before, after });
    } catch (error) {
      results.push({ image, status: 'failed', error: error.message });
    }
  }
  const updated = results.filter((item) => item.status === 'updated');
  if (updated.length) {
    await sendNotification('ComposeOps：发现镜像更新', updated.map((item) => item.image).join('\n')).catch(() => {});
  }
  setSetting('updates.last_results', JSON.stringify(results));
  return results;
}

export async function pruneDocker({ images = true, buildCache = true, containers = false, volumes = false }) {
  const result = {};
  if (images) result.images = await docker.pruneImages({ filters: { dangling: ['false'] } });
  if (buildCache) result.buildCache = await docker.pruneBuilds();
  if (containers) result.containers = await docker.pruneContainers();
  if (volumes) result.volumes = await docker.pruneVolumes();
  return result;
}
