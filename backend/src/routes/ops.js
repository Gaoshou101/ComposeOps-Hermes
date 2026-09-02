import { getSystemStorageDf, pruneStorage } from '../services/docker-storage.js';
import { listDockerResources, removeDockerResource } from '../services/docker-resources.js';
import { listBlueprints, deployBlueprint } from '../services/app-blueprints.js';
import { checkAllUpdates } from '../services/image-updater.js';
import { getNotificationConfig, saveNotificationConfig, sendNotification } from '../services/notifications.js';
import { getAlertEventConfig } from '../services/health-alerter.js';
import { addOperation } from '../lib/db.js';
import { listAlertEvents, updateAlertEvent, pruneAlertEvents } from '../services/events.js';
import { notificationConfigBody } from '../lib/schemas.js';

/**
 * 本文件的 schema 一律不收紧服务端已有的归一化语义:
 * 1. mode/confirm 不设 enum/const —— 处理函数把未知 mode 归一为 safe,并自己返回
 *    confirmation_required 机器码,schema 抢先拦下会改变语义或降级错误码;
 * 2. days/limit 只挡非数值,越界由 db.js 的 clamp 兜住;
 * 3. blueprints/deploy 的 values 是蓝图自带的模板变量表(键由蓝图定义,无法枚举),
 *    故整个 body 保持开放 —— 声明 additionalProperties: false 会被 removeAdditional
 *    静默剥掉所有变量,部署出一份缺变量的 compose。
 */
const alertEventBody = {
  type: 'object',
  additionalProperties: false,
  properties: { read: { type: 'boolean' }, muted: { type: 'boolean' } },
};

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

  fastify.post('/storage/prune', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mode: { type: 'string', maxLength: 16 },
          confirm: { type: 'string', maxLength: 32 },
        },
      },
    },
  }, async (request, reply) => {
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

  // ---- 细粒度资源清单与逐项删除(镜像 / 卷 / 网络) ----
  fastify.get('/storage/resources', async (request, reply) => {
    try {
      return await listDockerResources();
    } catch (error) {
      return reply.code(error.statusCode || 502).send({ error: 'resources_list_failed', message: error.message });
    }
  });

  // kind 不设 enum:处理函数自己归一 image|volume|network 并返回 400。
  // 卷删除默认 force,避免"被引用卷删除静默失败"的糟糕体验。
  fastify.delete('/storage/resources/:kind/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['kind', 'id'],
        properties: { kind: { type: 'string', maxLength: 16 }, id: { type: 'string', minLength: 1, maxLength: 200 } },
      },
    },
  }, async (request, reply) => {
    const { kind, id } = request.params;
    if (!['image', 'volume', 'network'].includes(kind)) {
      return reply.code(400).send({ error: 'unknown_resource_kind', message: `未知资源类型:${kind}` });
    }
    try {
      const result = await removeDockerResource(kind, id, true);
      addOperation({ action: `resource.remove.${kind}`, status: 'success', detail: id });
      return { ok: true, ...result };
    } catch (error) {
      return reply.code(error.statusCode || 502).send({ error: 'resource_remove_failed', message: error.message });
    }
  });

  // ---- 应用模板市场 ----
  fastify.get('/blueprints', async () => ({ blueprints: listBlueprints() }));

  // values 刻意不声明子属性:蓝图变量名由蓝图自己定义,一旦收紧就会被剥空。
  // blueprintId 缺失仍由处理函数返回 missing_blueprint_id,故这里不设 required。
  fastify.post('/blueprints/deploy', {
    schema: {
      body: {
        type: 'object',
        properties: {
          blueprintId: { type: 'string', maxLength: 200 },
          values: { type: 'object' },
        },
      },
    },
  }, async (request, reply) => {
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

  fastify.put('/notifications/events', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: { events: notificationConfigBody.properties.events },
      },
    },
  }, async (request) => {
    const config = saveNotificationConfig({ events: request.body?.events });
    return { events: config.events || [] };
  });

  // 与 personal.js 的 /notifications 共用同一份键集:此处会真的落库,漏键即存不上。
  fastify.post('/notifications/test', { schema: { body: notificationConfigBody } }, async (request, reply) => {
    try {
      const config = saveNotificationConfig(request.body || {});
      await sendNotification('ComposeOps 测试通知', '多渠道告警配置成功。', getNotificationConfig(false));
      return { ok: true, config };
    } catch (error) {
      return reply.code(502).send({ error: 'notification_failed', message: error.message });
    }
  });

  // ---- 告警事件(EventCenter 数据源) ----
  fastify.get('/alert-events', {
    schema: {
      querystring: {
        type: 'object',
        properties: { limit: { type: 'integer', minimum: 1, maximum: 200 } },
      },
    },
  }, async (request) => {
    return { events: listAlertEvents(request.query?.limit) };
  });

  // id 不声明为 integer:处理函数自己 Number.isInteger 校验并返回 invalid_event_id。
  fastify.patch('/alert-events/:id', {
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', maxLength: 32 } } },
      body: alertEventBody,
    },
  }, async (request, reply) => {
    const id = Number(request.params?.id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'invalid_event_id' });
    const { read, muted } = request.body || {};
    const event = updateAlertEvent(id, { read, muted });
    if (!event) return reply.code(404).send({ error: 'event_not_found' });
    return { event };
  });

  // days 越界由处理函数 clamp 到 1..90,schema 只挡非数值类型。
  fastify.post('/alert-events/prune', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: { days: { type: 'number' } },
      },
    },
  }, async (request) => {
    const days = Math.max(1, Math.min(Number(request.body?.days) || 7, 90));
    const result = pruneAlertEvents(days);
    return { ok: true, removed: result.changes };
  });
}
