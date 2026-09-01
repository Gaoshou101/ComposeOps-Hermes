import docker from './docker.js';
import { getSetting, setSetting } from '../lib/db.js';
import { scanProjects } from './scanner.js';
import { getNotificationConfig, sendNotification } from './notifications.js';
import { checkImageUpdates, getDockerUsage } from './maintenance.js';
import { recordAlertEventAndNotify } from './events.js';

const previousStates = new Map();
const cooldowns = new Map();
let timer;
let running = false;

function canAlert(key, hours = 6) {
  const last = cooldowns.get(key) || 0;
  if (Date.now() - last < hours * 3600000) return false;
  cooldowns.set(key, Date.now());
  return true;
}

async function poll() {
  if (running) return;
  running = true;
  try {
    const config = getNotificationConfig(false);
    const projects = await scanProjects();
    const managedProjects = projects.filter((item) => item.managed);
    const managedContainerIds = new Set(managedProjects.flatMap((project) => project.containers.map((item) => item.id)));
    for (const containerId of previousStates.keys()) {
      if (!managedContainerIds.has(containerId)) previousStates.delete(containerId);
    }
    if (config.enabled) {
      for (const project of managedProjects) {
        for (const item of project.containers) {
          const previous = previousStates.get(item.id);
          if (previous === 'running' && item.state !== 'running' && canAlert(`exit:${item.id}`, 1)) {
            recordAlertEventAndNotify({
              key: `${item.id}:exit`,
              title: 'ComposeOps:容器已退出',
              detail: `${project.projectName} / ${item.name} · ${item.statusText}`,
              priority: 'danger',
              to: `/services?focus=${project.id}`,
            });
            await sendNotification('ComposeOps：容器已退出', `${project.projectName} / ${item.name}\n${item.statusText}`)
              .catch(() => {});
          }
          previousStates.set(item.id, item.state);
          if (item.state === 'running') {
            try {
              const stats = await docker.getContainer(item.id).stats({ stream: false });
              const usage = stats.memory_stats?.usage || 0;
              const limit = stats.memory_stats?.limit || 0;
              const percent = limit ? usage / limit * 100 : 0;
              if (percent >= config.memoryThreshold && canAlert(`memory:${item.id}`)) {
                recordAlertEventAndNotify({
                  key: `${item.id}:memory`,
                  title: 'ComposeOps:容器内存告警',
                  detail: `${project.projectName} / ${item.name}: ${percent.toFixed(1)}%`,
                  priority: 'warning',
                  to: `/services?focus=${project.id}`,
                });
                await sendNotification('ComposeOps：容器内存告警', `${project.projectName} / ${item.name}: ${percent.toFixed(1)}%`)
                  .catch(() => {});
              }
            } catch {}
          }
        }
      }
      const usage = await getDockerUsage().catch(() => null);
      if (usage && usage.total >= config.dockerStorageThresholdGb * 1024 ** 3 && canAlert('docker-storage')) {
        recordAlertEventAndNotify({
          key: 'docker-storage',
          title: 'ComposeOps:Docker 空间告警',
          detail: `镜像与构建缓存占用 ${(usage.total / 1024 ** 3).toFixed(1)} GB`,
          priority: 'warning',
          to: '/settings?tab=maintenance',
        });
        await sendNotification('ComposeOps：Docker 空间告警', `镜像与构建缓存占用 ${(usage.total / 1024 ** 3).toFixed(1)} GB`)
          .catch(() => {});
      }
    }

    const autoUpdate = getSetting('updates.auto_enabled', '0') === '1';
    const intervalHours = Math.max(1, Number(getSetting('updates.interval_hours', '24')) || 24);
    const lastCheck = Number(getSetting('updates.last_check', '0')) || 0;
    if (autoUpdate && Date.now() - lastCheck >= intervalHours * 3600000) {
      setSetting('updates.last_check', String(Date.now()));
      await checkImageUpdates().catch(() => {});
    }
  } finally {
    running = false;
  }
}

export function startAlertMonitor() {
  if (timer || process.env.DISABLE_BACKGROUND_JOBS === '1') return;
  const interval = Math.max(30, getNotificationConfig(false).intervalSeconds) * 1000;
  timer = setInterval(poll, interval);
  timer.unref();
  setTimeout(poll, 5000).unref();
}

export function stopAlertMonitor() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function restartAlertMonitor() {
  stopAlertMonitor();
  startAlertMonitor();
}
