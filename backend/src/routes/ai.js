import { getAiConfig, setAiConfig, callOpenAI, addAiMessage, getAiHistory, clearAiHistory } from '../services/ai.js';
import docker from '../services/docker.js';
import { findProjectContainer } from '../services/scanner.js';
import { readCompose } from '../services/compose-runner.js';

export default async function aiRoutes(fastify) {
  // GET /api/v1/ai/config
  fastify.get('/config', async () => {
    const cfg = getAiConfig();
    return { ...cfg, apiKey: cfg.apiKey ? '••••' + cfg.apiKey.slice(-4) : '' };
  });

  // POST /api/v1/ai/config  body: { baseUrl, apiKey, model, systemPrompt }
  fastify.post('/config', async (request, reply) => {
    const { baseUrl, apiKey, model, systemPrompt } = request.body || {};
    try {
      setAiConfig({ baseUrl, apiKey, model, systemPrompt });
      return { ok: true };
    } catch (error) {
      return reply.code(400).send({ error: 'invalid_ai_config', message: error.message });
    }
  });

  // GET /api/v1/ai/history
  fastify.get('/history', async () => {
    return { messages: getAiHistory(50) };
  });

  // DELETE /api/v1/ai/history
  fastify.delete('/history', async () => {
    clearAiHistory();
    return { ok: true };
  });

  // POST /api/v1/ai/chat
  // body: { message, stream?:true } —— 通用对话，SSE 流式返回
  fastify.post('/chat', async (request, reply) => {
    const { message } = request.body || {};
    if (!message) return reply.code(400).send({ error: 'missing message' });
    const cfg = getAiConfig();
    if (!cfg.apiKey) return reply.code(400).send({ error: 'ai_not_configured', message: '请先在设置中配置 API Key' });

    const messages = [
      { role: 'system', content: cfg.systemPrompt },
      ...getAiHistory(10).map(({ role, content }) => ({ role, content })),
      { role: 'user', content: message },
    ];
    addAiMessage('user', message);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    });
    const send = (type, data) => reply.raw.write(`data: ${JSON.stringify({ type, data })}\n\n`);

    const controller = new AbortController();
    let completed = false;
    reply.raw.on('close', () => { if (!completed) controller.abort(); });
    try {
      const full = await callOpenAI({
        ...cfg,
        messages,
        stream: true,
        onToken: (t) => send('token', t),
        signal: controller.signal,
      });
      addAiMessage('assistant', full);
      send('done', full);
    } catch (e) {
      send('error', e.message);
    } finally {
      completed = true;
      reply.raw.end();
    }
  });

  // POST /api/v1/ai/diagnose
  // body: { containerId, composeContent } —— 一键日志排错
  // 自动组装：系统 Prompt + 最近 100 行容器日志 + compose 文件内容
  fastify.post('/diagnose', async (request, reply) => {
    const { projectId, containerId } = request.body || {};
    if (!projectId || !containerId) return reply.code(400).send({ error: 'missing projectId or containerId' });
    const cfg = getAiConfig();
    if (!cfg.apiKey) return reply.code(400).send({ error: 'ai_not_configured', message: '请先配置 API Key' });

    const match = await findProjectContainer(projectId, containerId);
    if (!match.project || !match.container) {
      return reply.code(404).send({ error: 'container_not_found', message: '容器不属于当前项目' });
    }
    if (!match.project.managed) {
      return reply.code(403).send({ error: 'project_not_managed', message: '项目尚未加入管理' });
    }

    let composeContent = '';
    if (match.project.editable) {
      try { composeContent = (await readCompose(match.project, 0)).content.slice(0, 50000); } catch {}
    }

    // 取最近 200 行日志（非 follow）
    let logs = '';
    try {
      const container = docker.getContainer(match.container.id);
      const inspection = await container.inspect().catch(() => null);
      const logStream = await container.logs({ follow: false, stdout: true, stderr: true, tail: 200, timestamps: false });
      if (inspection?.Config?.Tty) {
        logs = Buffer.isBuffer(logStream) ? logStream.toString('utf8') : '';
      } else {
      const { demuxStream } = await import('../lib/docker-streams.js');
      const demux = demuxStream();
      const chunks = [];
      demux.stdout.on('data', (b) => chunks.push(b));
      demux.stderr.on('data', (b) => chunks.push(b));
      if (Buffer.isBuffer(logStream)) demux.end(logStream);
      else logStream.pipe(demux);
      await Promise.all([
        new Promise((resolve) => demux.stdout.on('end', resolve)),
        new Promise((resolve) => demux.stderr.on('end', resolve)),
      ]);
      logs = Buffer.concat(chunks).toString('utf8');
      }
    } catch (e) {
      logs = `读取日志失败: ${e.message}`;
    }

    const userPrompt = `请帮我分析以下容器为什么启动失败或异常退出，并给出根因与修复建议。
${composeContent ? `\n--- docker-compose.yml ---\n${composeContent}\n` : ''}
--- 最近日志 ---
${logs.slice(-50000)}
`;

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    });
    const send = (type, data) => reply.raw.write(`data: ${JSON.stringify({ type, data })}\n\n`);

    addAiMessage('user', `诊断容器 ${match.container.name}`, { projectId, containerId: match.container.id });
    const controller = new AbortController();
    let completed = false;
    reply.raw.on('close', () => { if (!completed) controller.abort(); });
    try {
      const full = await callOpenAI({
        ...cfg,
        messages: [
          { role: 'system', content: cfg.systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        stream: true,
        onToken: (t) => send('token', t),
        signal: controller.signal,
      });
      addAiMessage('assistant', full, { projectId, containerId: match.container.id });
      send('done', full);
    } catch (e) {
      send('error', e.message);
    } finally {
      completed = true;
      reply.raw.end();
    }
  });
}
