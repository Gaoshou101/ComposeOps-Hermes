/**
 * 只读容器命令执行与日志读取。
 *
 * 供 AI 排障(services/ai 调用链)与 Agent 工具(services/agent-tools)共用,
 * 避免两处各自维护一份 exec 白名单 / 日志读取实现(曾因两份实现出现严格性漂移)。
 */

/** 只读探测命令白名单:仅允许不带副作用的信息类命令。curl/wget 已移除:可发起外部请求。 */
export const READONLY_EXEC = /^(env|printenv|ps|top\s+-b\s+-n\s+1|netstat|ss|cat|head|tail|ls|df|du|free|uptime|uname|hostname|date|whoami|id|ip\s+addr|ping\s+-c\s+\d+)/;

/**
 * 在容器内静默执行一条只读命令,返回 stdout/stderr/exitCode/durationMs。
 * @param {object} container - dockerode Container 实例
 * @param {string} cmdString - 完整命令字符串,首个 token 须命中 READONLY_EXEC 白名单
 */
export async function execReadonly(container, cmdString) {
  const parts = String(cmdString || '').trim().split(/\s+/);
  if (!parts.length) throw new Error('命令为空');
  if (!READONLY_EXEC.test(parts[0])) {
    throw new Error('仅允许执行只读探测命令(env/ps/netstat/cat/tail/ls/df/free 等)');
  }
  const started = Date.now();
  const exec = await container.exec({ AttachStdout: true, AttachStderr: true, Cmd: parts });
  const stream = await exec.start({ Tty: false });
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const output = Buffer.concat(chunks).toString('utf8');
  const inspect = await exec.inspect().catch(() => null);
  return { stdout: output.slice(0, 20000), exitCode: inspect?.ExitCode ?? null, durationMs: Date.now() - started };
}

/**
 * 读取容器最近 tail 行日志(自动处理 TTY 单流与多路复用流)。失败时返回错误描述字符串,绝不抛出。
 * @param {object} container - dockerode Container 实例
 * @param {number} tail - 读取的行数
 */
export async function readContainerLogs(container, tail = 200) {
  try {
    const inspection = await container.inspect().catch(() => null);
    const logStream = await container.logs({ follow: false, stdout: true, stderr: true, tail, timestamps: false });
    if (inspection?.Config?.Tty) {
      return Buffer.isBuffer(logStream) ? logStream.toString('utf8') : '';
    }
    const { demuxStream } = await import('./docker-streams.js');
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
  } catch (error) {
    return `读取日志失败: ${error.message}`;
  }
}