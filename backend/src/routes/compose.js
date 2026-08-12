import { spawn } from 'child_process';
import path from 'path';
import { readText, writeText, validateYaml } from '../lib/files.js';

const COMPOSE_BIN = process.env.COMPOSE_BIN || 'docker'; // 'docker' -> 'docker compose'
const ALLOWED_ROOT = process.env.ALLOWED_ROOT || '';

/**
 * 现代用 `docker compose`（带空格子命令）。
 * 返回 [bin, ...sub] 形式的参数数组前缀。
 */
function composeBase() {
  if (COMPOSE_BIN === 'docker') return ['docker', 'compose'];
  if (COMPOSE_BIN === 'docker-compose') return ['docker-compose'];
  return COMPOSE_BIN.split(/\s+/);
}

function denyIfRestricted(absPath) {
  if (!ALLOWED_ROOT) return;
  const root = path.resolve(ALLOWED_ROOT);
  if (!absPath.startsWith(root + path.sep) && absPath !== root) {
    throw new Error(`path outside allowed root: ${absPath}`);
  }
}

export default async function composeRoutes(fastify) {
  // GET /api/v1/compose/file?path=...
  fastify.get('/file', async (request, reply) => {
    const { path: file } = request.query;
    if (!file) return reply.code(400).send({ error: 'missing path param' });
    try {
      denyIfRestricted(path.resolve(file));
      const content = await readText(file);
      return { path: file, content };
    } catch (e) {
      if (e.code === 'ENOENT') return reply.code(404).send({ error: 'not_found', message: e.message });
      return reply.code(400).send({ error: 'read_failed', message: e.message });
    }
  });

  // POST /api/v1/compose/file  —— 保存前做 YAML 合法性校验
  fastify.post('/file', async (request, reply) => {
    const { path: file, content } = request.body || {};
    if (!file || typeof content !== 'string') {
      return reply.code(400).send({ error: 'missing path or content' });
    }
    denyIfRestricted(path.resolve(file));
    try {
      validateYaml(content);
    } catch (e) {
      return reply.code(422).send({
        error: 'yaml_invalid',
        message: e.message,
        line: e.line,
        column: e.column,
      });
    }
    try {
      await writeText(file, content);
      return { ok: true, path: file };
    } catch (e) {
      return reply.code(500).send({ error: 'write_failed', message: e.message });
    }
  });

  // POST /api/v1/compose/control
  // body: { workingDir, file, command, extraArgs }
  // command: up | down | restart | pull | ps | logs | config
  // 输出以 SSE 流式回传；命令默认前台执行，前端传 extraArgs: ['-d'] 可后台
  fastify.post('/control', async (request, reply) => {
    const { workingDir, file = 'docker-compose.yml', command, extraArgs = [] } = request.body || {};
    const allowed = ['up', 'down', 'restart', 'pull', 'ps', 'logs', 'config'];
    if (!allowed.includes(command)) {
      return reply.code(400).send({ error: 'unsupported_command', command });
    }
    if (!workingDir) return reply.code(400).send({ error: 'missing workingDir' });
    denyIfRestricted(path.resolve(workingDir));

    const base = composeBase();
    const args = [...base.slice(1), '-f', file, command, ...extraArgs];
    const absBin = base[0];

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (type, data) =>
      reply.raw.write(`data: ${JSON.stringify({ type, data })}\n\n`);

    fastify.log.info({ absBin, args, cwd: workingDir }, 'compose exec');

    const child = spawn(absBin, args, {
      cwd: workingDir,
      env: { ...process.env, COMPOSE_HTTP_TIMEOUT: '300', COMPOSE_PROGRESS: 'plain' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (b) => send('stdout', b.toString('utf8')));
    child.stderr.on('data', (b) => send('stderr', b.toString('utf8')));
    child.on('error', (err) => send('error', `${err.name}: ${err.message}`));

    let finished = false;
    child.on('close', (code) => {
      finished = true;
      send('exit', `code=${code}`);
      reply.raw.end();
    });

    // 客户端在子进程结束前主动断开 -> 终止子进程。
    // 必须监听 reply.raw（响应流）而非 request.raw：Fastify 4 中 request.raw 的 'close'
    // 会在响应头写出后立即触发，导致子进程被误杀，从而丢失所有 stdout 输出。
    reply.raw.on('close', () => {
      if (finished) return;
      if (child.exitCode === null && !child.killed) {
        try { child.kill('SIGTERM'); } catch {}
      }
    });
  });
}
