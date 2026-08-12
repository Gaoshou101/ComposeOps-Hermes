import { getAiConfig, setAiConfig, callOpenAI, addAiMessage, getAiHistory, clearAiHistory } from '../services/ai.js';
import docker from '../services/docker.js';

export default async function aiRoutes(fastify) {
  // GET /api/v1/ai/config
  fastify.get('/config', async () => {
    const cfg = getAiConfig();
    return { ...cfg, apiKey: cfg.apiKey ? '••••' + cfg.apiKey.slice(-4) : '' };
  });

  // POST /api/v1/ai/config  body: { baseUrl, apiKey, model, systemPrompt }
  fastify.post('/config', async (request, reply) => {
    const { baseUrl, apiKey, model, systemPrompt } = request.body || {};
    setAiConfig({ baseUrl, apiKey, model, systemPrompt });
    return { ok: true };
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
      ...getAiHistory(10),
      { role: 'user', content: message },
    ];
    addAiMessage('user', message);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    });
    const send = (type, data) => reply.raw.write(`data: ${JSON.stringify({ type, data })}\n\n`);

    try {
      const full = await callOpenAI({
        ...cfg,
        messages,
        stream: true,
        onToken: (t) => send('token', t),
      });
      addAiMessage('assistant', full);
      send('done', full);
    } catch (e) {
      send('error', e.message);
    } finally {
      reply.raw.end();
    }
  });

  // POST /api/v1/ai/diagnose
  // body: { containerId, composeContent } —— 一键日志排错
  // 自动组装：系统 Prompt + 最近 100 行容器日志 + compose 文件内容
  fastify.post('/diagnose', async (request, reply) => {
    const { containerId, composeContent = '' } = request.body || {};
    if (!containerId) return reply.code(400).send({ error: 'missing containerId' });
    const cfg = getAiConfig();
    if (!cfg.apiKey) return reply.code(400).send({ error: 'ai_not_configured', message: '请先配置 API Key' });

    // 取最近 100 行日志（非 follow）
    let logs = '';
    try {
      const container = docker.getContainer(containerId);
      const logStream = await container.logs({ follow: false, stdout: true, stderr: true, tail: 100, timestamps: false });
      const { demuxStream } = await import('../lib/docker-streams.js');
      const demux = demuxStream();
      logStream.pipe(demux);
      const chunks = [];
      demux.stdout.on('data', (b) => chunks.push(b));
      demux.stderr.on('data', (b) => chunks.push(b));
      await new Promise((resolve) => demux.stdout.on('end', resolve));
      logs = Buffer.concat(chunks).toString('utf8');
    } catch (e) {
      logs = `读取日志失败: ${e.message}`;
    }

    const userPrompt = `请帮我分析以下容器为什么启动失败或异常退出，并给出根因与修复建议。
${composeContent ? `\n--- docker-compose.yml ---\n${composeContent}\n` : ''}
--- 最近日志 ---
${logs}
`;

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    });
    const send = (type, data) => reply.raw.write(`data: ${JSON.stringify({ type, data })}\n\n`);

    try {
      const full = await callOpenAI({
        ...cfg,
        messages: [
          { role: 'system', content: cfg.systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        stream: true,
        onToken: (t) => send('token', t),
      });
      send('done', full);
    } catch (e) {
      send('error', e.message);
    } finally {
      reply.raw.end();
    }
  });
}
