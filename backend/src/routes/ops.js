import { getSystemStorageDf, pruneStorage } from '../services/docker-storage.js';
import { listBlueprints, deployBlueprint } from '../services/app-blueprints.js';
import { checkAllUpdates } from '../services/image-updater.js';
import { getNotificationConfig, saveNotificationConfig, sendNotification } from '../services/notifications.js';
import { getAlertEventConfig } from '../services/health-alerter.js';
import { addOperation } from '../lib/db.js';

export default async function opsRoutes(fastify) {
  // ---- 镜像更新雷达:全局检测 ----
  fastify.post('/updates/check-all', async (request, reply) => {
    try {
      const result = await checkAllUpdates();
      addOperation({ action: 'images.radar', status: 'success', detail: `${result.projects.length} 个项目已检查` });
      return result;
    } catch (error) {
      return reply.code(502).send({ error: 'updates_radar_failed', message: error.message });
    }
  });

  // ---- Docker 磁盘空间可视化与安全清理 ----
  fastify.get('/storage/df', async (request, reply) => {
    try {
      return await getSystemStorageDf();
    } catch (error) {
      return reply.code(error.statusCode || 502).send({ error: 'storage_df_failed', message: error.message });
    }
  });

  fastify.post('/storage/prune', async (request, reply) => {
    const mode = ['safe', 'volumes', 'builder', 'all'].includes(request.body?.mode) ? request.body.mode : 'safe';
    if ((mode === 'volumes' || mode === 'all') && request.body?.confirm !== 'PRUNE') {
      return reply.code(400).send({ error: 'confirmation_required', message: '深度清理需要二次确认(输入 PRUNE)' });
    }
    try {
      const result = await pruneStorage(mode);
      addOperation({ action: `storage.prune.${mode}`, status: 'success', detail: `${result.reclaimedMB} MB` });
      return { ok: true, ...result };
    } catch (error) {
      return reply.code(502).send({ error: 'storage_prune_failed', message: error.message });
    }
  });

  // ---- 应用模板市场 ----
  fastify.get('/blueprints', async () => ({ blueprints: listBlueprints() }));

  fastify.post('/blueprints/deploy', async (request, reply) => {
    const { blueprintId, values } = request.body || {};
    if (!blueprintId) return reply.code(400).send({ error: 'missing_blueprint_id' });
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (type, data) => {
      if (!reply.raw.destroyed) reply.raw.write(`data: ${JSON.stringify({ type, data })}\n\n`);
    };
    let output = '';
    let finished = false;
    const finish = (payload) => {
      if (finished) return;
      finished = true;
      send('result', payload);
      reply.raw.end();
    };
    let child;
    deployBlueprint(blueprintId, values || {}, {
      onOutput: (type, text) => { output += text; send(type, text); },
      onChild: (process) => { child = process; },
    }).then((result) => {
      send('exit', { code: result.code });
      finish({ ok: true, ...result, output });
    }).catch((error) => {
      const text = `${error.message}\n`;
      output += text;
      send('stderr', text);
      finish({ ok: false, message: error.message, output });
    });
    reply.raw.on('close', () => {
      if (!finished && child && child.exitCode === null && !child.killed) child.kill('SIGTERM');
    });
  });

  // ---- 健康告警事件配置(与通知配置合并存储) ----
  fastify.get('/notifications/events', async () => {
    const config = getNotificationConfig(false);
    return { events: config.events || getAlertEventConfig().events };
  });

  fastify.put('/notifications/events', async (request) => {
    const config = saveNotificationConfig({ events: request.body?.events });
    return { events: config.events || [] };
  });

  fastify.post('/notifications/test', async (request, reply) => {
    try {
      const config = saveNotificationConfig(request.body || {});
      await sendNotification('ComposeOps 测试通知', '多渠道告警配置成功。', getNotificationConfig(false));
      return { ok: true, config };
    } catch (error) {
      return reply.code(502).send({ error: 'notification_failed', message: error.message });
    }
  });
}
