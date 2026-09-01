import { getAiConfig, setAiConfig, callOpenAI, addAiMessage, getAiHistory, clearAiHistory, fetchAiModels } from '../services/ai.js';
import { clearAiSession, listAiSessions } from '../lib/db.js';
import { getActivityDocker } from '../services/docker-hosts.js';
import { findProjectContainer } from '../services/scanner.js';
import { readCompose } from '../services/compose-runner.js';
import { readWorkspaceCompose } from '../services/compose-workspace.js';

/** 只读探测命令白名单:仅允许不带副作用的信息类命令。 */
const READONLY_EXEC = /^(env|printenv|ps|top\s+-b\s+-n\s+1|netstat|ss|curl|wget|cat|head|tail|ls|df|du|free|uptime|uname|hostname|date|whoami|id|ip\s+addr|ping\s+-c\s+\d+)/;

/** 在容器内静默执行一条只读命令,返回 stdout/stderr/exitCode/durationMs。 */
async function execReadonly(container, cmdString) {
  const parts = String(cmdString || '').trim().split(/\s+/);
  if (!parts.length) throw new Error('命令为空');
  if (!READONLY_EXEC.test(parts[0])) {
    throw new Error('仅允许执行只读探测命令(env/ps/netstat/curl/cat/tail/ls/df/free 等)');
  }
  const started = Date.now();
  const exec = await container.exec({
    AttachStdout: true,
    AttachStderr: true,
    Cmd: parts,
  });
  const stream = await exec.start({ Tty: false });
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const output = Buffer.concat(chunks).toString('utf8');
  const inspect = await exec.inspect().catch(() => null);
  return {
    stdout: output.slice(0, 20000),
    exitCode: inspect?.ExitCode ?? null,
    durationMs: Date.now() - started,
  };
}


/** 读取容器最近 tail 行日志(自动处理 TTY 单流与多路复用流)。失败时返回错误描述字符串,绝不抛出。 */
async function readContainerLogs(container, tail = 200) {
  try {
    const inspection = await container.inspect().catch(() => null);
    const logStream = await container.logs({ follow: false, stdout: true, stderr: true, tail, timestamps: false });
    if (inspection?.Config?.Tty) {
      return Buffer.isBuffer(logStream) ? logStream.toString('utf8') : '';
    }
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
    return Buffer.concat(chunks).toString('utf8');
  } catch (e) {
    return `读取日志失败: ${e.message}`;
  }
}

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

  // POST /api/v1/ai/fetch-models  body: { baseUrl?, apiKey? } —— 拉取远程可用模型列表
  fastify.post('/fetch-models', async (request, reply) => {
    const { baseUrl, apiKey } = request.body || {};
    try {
      const models = await fetchAiModels({ baseUrl, apiKey });
      return { models, count: models.length };
    } catch (error) {
      return reply.code(400).send({ error: 'fetch_models_failed', message: error.message });
    }
  });

  // POST /api/v1/ai/exec  body: { projectId, containerId, command } —— AI 排障只读探针
  fastify.post('/exec', async (request, reply) => {
    const { projectId, containerId, command } = request.body || {};
    if (!projectId || !containerId || !String(command || '').trim()) {
      return reply.code(400).send({ error: 'missing_params', message: '缺少 projectId / containerId / command' });
    }
    const match = await findProjectContainer(projectId, containerId);
    if (!match.project || !match.container) {
      return reply.code(404).send({ error: 'container_not_found', message: '容器不属于当前项目' });
    }
    if (!match.project.managed) {
      return reply.code(403).send({ error: 'project_not_managed', message: '项目尚未加入管理' });
    }
    const container = getActivityDocker().getContainer(match.container.id);
    try {
      const result = await execReadonly(container, command);
      addAiMessage('tool', `容器内执行只读探测命令:${command}`, { projectId, containerId: match.container.id });
      return { ok: true, ...result };
    } catch (error) {
      return reply.code(400).send({ error: 'exec_failed', message: error.message });
    }
  });

  // POST /api/v1/ai/logs  body: { projectId, containerId, tail? } —— AI 排障使用的容器日志上下文
  fastify.post('/logs', async (request, reply) => {
    const { projectId, containerId, tail } = request.body || {};
    if (!projectId || !containerId) return reply.code(400).send({ error: 'missing_params', message: '缺少 projectId / containerId' });
    const match = await findProjectContainer(projectId, containerId);
    if (!match.project || !match.container) {
      return reply.code(404).send({ error: 'container_not_found', message: '容器不属于当前项目' });
    }
    if (!match.project.managed) {
      return reply.code(403).send({ error: 'project_not_managed', message: '项目尚未加入管理' });
    }
    const container = getActivityDocker().getContainer(match.container.id);
    const logs = await readContainerLogs(container, Math.min(Math.max(Number(tail) || 200, 20), 2000));
    return { logs, count: logs.split('\n').filter((l) => l.trim()).length };
  });

  // GET /api/v1/ai/history?sessionId=<id>&limit=100 —— 会话消息(留空取全部)
  fastify.get('/history', async (request) => {
    const sessionId = request.query?.sessionId;
    const limit = Math.max(1, Math.min(Number(request.query?.limit) || 100, 200));
    const messages = sessionId ? getAiHistory(limit, Number(sessionId)) : getAiHistory(limit);
    return { messages };
  });

  // GET /api/v1/ai/sessions —— 会话列表(标题/时间/消息数)
  fastify.get('/sessions', async (request) => {
    return { sessions: listAiSessions(request.query?.limit) };
  });

  // DELETE /api/v1/ai/history?sessionId=<id> —— 删除指定会话;不带参数清空全部
  fastify.delete('/history', async (request) => {
    const sessionId = request.query?.sessionId;
    if (sessionId) {
      clearAiSession(Number(sessionId));
      return { ok: true, sessionId: Number(sessionId) };
    }
    clearAiHistory();
    return { ok: true };
  });

  // POST /api/v1/ai/chat
  // body: { message, stream?:true } —— 通用对话，SSE 流式返回
  fastify.post('/chat', async (request, reply) => {
    const { message, webSearch, sessionId } = request.body || {};
    let sources = [];
    if (webSearch) {
      try {
        sources = await searchWeb(message);
      } catch {}
    }
    if (!message) return reply.code(400).send({ error: 'missing message' });
    const cfg = getAiConfig();
    if (!cfg.apiKey) return reply.code(400).send({ error: 'ai_not_configured', message: '请先在设置中配置 API Key' });

    // 会话上下文:同一 sessionId 复用最近的对话轮次;未提供则默认取全局最近 10 条。
    const contextMessages = sessionId
      ? getAiHistory(10, Number(sessionId))
      : getAiHistory(10);
    const messages = [
      { role: 'system', content: cfg.systemPrompt },
      ...contextMessages.map(({ role, content }) => ({ role, content })),
      { role: 'user', content: message },
    ];
    if (sources.length) messages.push({ role: 'system', content: `以下是联网检索结果(供参考,如有冲突以检索为准):\n${sources.map((r, i) => `[${i + 1}] ${r.title}${r.url ? ' (' + r.url + ')' : ''}\n${r.snippet}`).join('\n\n')}` });
    const resolvedSessionId = sessionId ? Number(sessionId) : null;
    addAiMessage('user', message, null, resolvedSessionId);

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
      addAiMessage('assistant', full, null, resolvedSessionId);
      send('done', full);
      if (sources.length) send('sources', sources);
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
    const { projectId, containerId, sessionId } = request.body || {};
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
      try {
        const compose = match.project.mounted
          ? await readCompose(match.project, 0)
          : await readWorkspaceCompose(match.project, 0);
        composeContent = compose.content.slice(0, 50000);
      } catch {}
    }

    // 优先使用前端传入的失败上下文(rawLogs),否则回退拉取最近 200 行日志
    const { rawLogs, failedCommand, exitCode, envKeys, webSearch } = request.body || {};
    let logs = String(rawLogs || '').slice(-50000);
    if (!logs) {
      const container = getActivityDocker().getContainer(match.container.id);
      logs = await readContainerLogs(container, 200);
    }
    let sources = [];
    if (webSearch) {
      try {
        const summary = `容器 ${match.container.name} 诊断:${failedCommand || ''} 退出码 ${exitCode ?? '?'} 日志摘要 ${logs.slice(-400)}`;
        sources = await searchWeb(summary.slice(0, 300));
      } catch {}
    }

    const redactedEnv = (Array.isArray(envKeys) ? envKeys : []).map(({ key, value }) => {
      const isSecret = /(SECRET|TOKEN|PASSWORD|PASSWD|\bPASS\b|(?:API|PRIVATE|ACCESS|SECRET|AUTH|SIGNING)[_-]?KEY)/i.test(key || '');
      return `${key}=${isSecret ? '••••••' : value || ''}`;
    }).join('\n');

    const userPrompt = `请帮我分析以下容器为什么启动失败或异常退出,并给出根因与修复建议。
${failedCommand ? `\n--- 失败命令 ---\n${failedCommand}\n` : ''}
${exitCode != null ? `\n--- 退出码 ---\n${exitCode}\n` : ''}
${redactedEnv ? `\n--- 环境变量键(敏感值已脱敏) ---\n${redactedEnv}\n` : ''}
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

    const resolvedSessionId = sessionId ? Number(sessionId) : null;
    addAiMessage('user', `诊断容器 ${match.container.name}`, { projectId, containerId: match.container.id }, resolvedSessionId);
    const controller = new AbortController();
    let completed = false;
    reply.raw.on('close', () => { if (!completed) controller.abort(); });
    try {
      const full = await callOpenAI({
        ...cfg,
        messages: [
          { role: 'system', content: cfg.systemPrompt },
          ...(sources.length ? [{ role: 'system', content: `以下是联网检索结果(供参考,如有冲突以检索为准):\n${sources.map((r, i) => `[${i + 1}] ${r.title}${r.url ? ' (' + r.url + ')' : ''}\n${r.snippet}`).join('\n\n')}` }] : []),
          { role: 'user', content: userPrompt },
        ],
        stream: true,
        onToken: (t) => send('token', t),
        signal: controller.signal,
      });
      addAiMessage('assistant', full, { projectId, containerId: match.container.id }, resolvedSessionId);
      send('done', full);
      if (sources.length) send('sources', sources);
    } catch (e) {
      send('error', e.message);
    } finally {
      completed = true;
      reply.raw.end();
    }
  });
}
