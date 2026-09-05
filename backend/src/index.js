import { buildApp } from './app.js';
import { startAlertMonitor } from './services/alert-monitor.js';
import { startHealthAlerter } from './services/health-alerter.js';
import { startCronScheduler } from './services/cron-scheduler.js';
import { initializeBackgroundJobs } from './services/background-jobs.js';
import { initGitOps } from './services/gitops.js';
import { startMetricsCollection } from './services/metrics-collector.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

const fastify = await buildApp();

const start = async () => {
  try {
    const interruptedJobs = initializeBackgroundJobs();
    if (interruptedJobs.length) fastify.log.warn({ jobs: interruptedJobs }, 'marked unfinished background jobs as interrupted');
    await fastify.listen({ port: PORT, host: HOST });
    startAlertMonitor();
    startHealthAlerter();
    startCronScheduler();
    initGitOps();
    startMetricsCollection(2); // 每 2 秒采集一次容器指标（Netdata 风格高频更新）
    fastify.log.info(`OpsDash backend listening on http://${HOST}:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  fastify.log.info({ signal }, 'shutting down');
  await fastify.close().catch((error) => fastify.log.error(error));
  process.exit(0);
}
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

start();
