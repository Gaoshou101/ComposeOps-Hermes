/**
 * MCP 端点(/mcp,Streamable HTTP;Hermes 定制 fork 新增)。
 *
 * 与面板共用同一个进程与同一份工具注册表,但鉴权完全独立:走 Bearer Token
 * (环境变量 MCP_TOKEN),不认会话 Cookie —— 面板的 Cookie 是 SameSite=Strict 的
 * 浏览器凭据,外部 Agent 拿不到也不该拿到。
 *
 * 安全取舍:
 *  - 未配置 MCP_TOKEN 时端点直接 503 关闭,不做"默认放行"或静默降级。
 *  - Token 比较走 sha256 后 timingSafeEqual,避免长度/前缀时序泄漏。
 *  - 无状态模式:每个请求一套 server+transport,并发请求之间不共享会话状态。
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from '../mcp/server.js';

const BEARER_PREFIX = 'bearer ';

/**
 * 校验 Bearer Token。空期望值一律判否(端点是否启用由调用方先判定)。
 * @param {string|undefined} authorization 请求头原文
 * @param {string} expected 期望 token
 * @returns {boolean}
 */
export function isAuthorized(authorization, expected) {
  if (!expected) return false;
  const header = String(authorization || '').trim();
  if (header.slice(0, BEARER_PREFIX.length).toLowerCase() !== BEARER_PREFIX) return false;
  const provided = header.slice(BEARER_PREFIX.length).trim();
  const providedHash = createHash('sha256').update(provided).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(providedHash, expectedHash);
}

export default async function mcpRoutes(fastify) {
  if (process.env.MCP_TOKEN) {
    fastify.log.info('MCP 端点已启用:POST /mcp(Bearer Token 鉴权)');
  } else {
    fastify.log.info('MCP 端点未启用:未配置 MCP_TOKEN');
  }

  fastify.all('/mcp', async (request, reply) => {
    const expected = process.env.MCP_TOKEN || '';
    if (!expected) {
      return reply.code(503).send({ error: 'mcp_disabled', message: '未配置 MCP_TOKEN,MCP 端点已关闭' });
    }
    if (!isAuthorized(request.headers.authorization, expected)) {
      return reply.code(401).send({ error: 'unauthorized', message: 'MCP 需要有效的 Bearer Token' });
    }

    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // 无状态:不签发会话 ID
      enableJsonResponse: true, // 工具调用是请求/响应语义,不需要常驻 SSE 流
    });

    // 交给 MCP transport 直接写原始响应,避免 Fastify 再去序列化一次。
    reply.hijack();
    reply.raw.on('close', () => {
      transport.close().catch(() => { /* 关闭失败无需处理:连接已断 */ });
      server.close().catch(() => { /* 同上 */ });
    });

    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });
}
