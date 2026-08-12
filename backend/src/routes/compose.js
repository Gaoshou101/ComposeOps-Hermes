import { spawn } from 'child_process';
import path from 'path';
import { readText, writeText, validateYaml } from '../lib/files.js';
import { discoverComposeRoots } from '../services/scanner.js';

const COMPOSE_BIN = process.env.COMPOSE_BIN || 'docker'; // 'docker' -> 'docker compose'
// 可选高级覆盖：若设置，则额外放行该根目录（用于挂载了 scanner 发现不到的目录的场景）。
// 未设置时，仅放行 Docker 自己上报的 compose working_dir（discoverComposeRoots）。
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

/**
 * 放行校验：路径要么落在 ALLOWED_ROOT（可选配置）下，
 * 要么是 Docker 自己上报的某个 compose working_dir 之下（动态发现，零配置）。
 * 这样编辑器只能碰已被 Docker 标记的 compose 项目，碰不到 SQLite 里的 API Key 等无关文件。
 */
async function assertAllowed(absPath) {
  if (ALLOWED_ROOT) {
    const root = path.resolve(ALLOWED_ROOT);
    if (absPath.startsWith(root + path.sep) || absPath === root) return;
  }
  const roots = await discoverComposeRoots();
  for (const r of roots) {
    const root = path.resolve(r);
    if (absPath.startsWith(root + path.sep) || absPath === root) return;
  }
  throw new Error(`path outside allowed compose roots: ${absPath}`);
}

export default async function composeRoutes(fastify) {
  // GET /api/v1/compose/file?path=...
  fastify.get('/file', async (request, reply) => {
    const { path: file } = request.query;
    if (!file) return reply.code(400).send({ error: 'missing path param' });
    try {
      await assertAllowed(path.resolve(file));
      const content = await readText(file);
      return { path: file, content };
    } catch (e) {
      if (e.message?.startsWith('path outside allowed')) {
        return reply.code(403).send({ error: 'forbidden', message: e.message });
      }
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
    try {
      await assertAllowed(path.resolve(file));
    } catch (e) {
      return reply.code(403).send({ error: 'forbidden', message: e.message });
    }
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
    try {
      await assertAllowed(path.resolve(workingDir));
    } catch (e) {
      return reply.code(403).send({ error: 'forbidden', message: e.message });
    }

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
