import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'composeops-mcp-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');
process.env.MCP_TOKEN = 'test-token-0123456789';

const { buildApp } = await import('../src/app.js');
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { getAgent } = await import('../src/services/agent.js');
const {
  DEFAULT_EXCLUDED_TOOLS,
  MCP_SERVER_NAME,
  createMcpServer,
  listMcpTools,
  needsConfirm,
  resolveExcludedTools,
  toMcpToolName,
} = await import('../src/mcp/server.js');
const { isAuthorized } = await import('../src/routes/mcp.js');

const app = await buildApp({ logger: false });
const baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });

test.after(async () => {
  await app.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

/** 用官方 MCP 客户端连真实监听端口,走完整握手(和 Hermes 接入方式一致)。 */
async function connectClient(token = process.env.MCP_TOKEN) {
  const client = new Client({ name: 'composeops-mcp-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}

test('mcp: 工具名转换只保留 MCP 合法字符', () => {
  assert.equal(toMcpToolName('compose.up'), 'compose_up');
  assert.equal(toMcpToolName('macro.safe_restart'), 'macro_safe_restart');
  assert.equal(toMcpToolName('a b/c'), 'a_b_c');
});

test('mcp: 默认屏蔽清单覆盖 critical 动作与任意命令执行入口', () => {
  assert.deepEqual(resolveExcludedTools(undefined), DEFAULT_EXCLUDED_TOOLS);
  for (const name of ['maintenance.clean', 'app.deploy', 'compose.exec', 'server.command']) {
    assert.ok(DEFAULT_EXCLUDED_TOOLS.includes(name), `默认应屏蔽 ${name}`);
  }
  // 显式空串表示不额外屏蔽(自建环境全量放开);逗号列表允许带空格。
  assert.deepEqual(resolveExcludedTools(''), []);
  assert.deepEqual(resolveExcludedTools('a.b, c.d'), ['a.b', 'c.d']);
});

test('mcp: 暴露的工具已过滤屏蔽项且名称无重复', () => {
  const all = getAgent().listTools();
  const { tools, duplicates } = listMcpTools();
  assert.deepEqual(duplicates, []);
  assert.equal(tools.length, all.length - DEFAULT_EXCLUDED_TOOLS.length);
  const names = tools.map((entry) => entry.mcpName);
  assert.equal(new Set(names).size, names.length, 'MCP 工具名不得重复');
  for (const name of names) {
    assert.match(name, /^[a-zA-Z0-9_-]+$/, `工具名 ${name} 含 MCP 非法字符`);
  }
  assert.ok(!names.includes('compose_exec'), '被屏蔽的工具不得出现在列表里');
  assert.ok(names.includes('compose_up'));
});

test('mcp: high/critical 工具判定为需确认', () => {
  assert.equal(needsConfirm({ risk: 'high' }), true);
  assert.equal(needsConfirm({ risk: 'critical' }), true);
  assert.equal(needsConfirm({ risk: 'low', confirmationRequired: true }), true);
  assert.equal(needsConfirm({ risk: 'low' }), false);
});

test('mcp: Bearer Token 校验拒绝缺失/错误/无期望值的输入', () => {
  const token = 'test-token-0123456789';
  assert.equal(isAuthorized(`Bearer ${token}`, token), true);
  assert.equal(isAuthorized(`bearer ${token}`, token), true, 'Bearer 前缀大小写不敏感');
  assert.equal(isAuthorized('Bearer wrong-token', token), false);
  assert.equal(isAuthorized('Basic abc', token), false);
  assert.equal(isAuthorized(undefined, token), false);
  assert.equal(isAuthorized(`Bearer ${token}`, ''), false, '未配置 token 时一律判否');
});

test('mcp: 未授权请求被拒且不泄露工具信息', async () => {
  const initBody = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'probe', version: '0' } },
  };
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  const missing = await fetch(`${baseUrl}/mcp`, { method: 'POST', headers, body: JSON.stringify(initBody) });
  assert.equal(missing.status, 401);
  const wrong = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { ...headers, Authorization: 'Bearer not-the-token' },
    body: JSON.stringify(initBody),
  });
  assert.equal(wrong.status, 401);
});

test('mcp: 官方客户端完成握手并拿到工具清单', async () => {
  const client = await connectClient();
  try {
    assert.equal(client.getServerVersion()?.name, MCP_SERVER_NAME);
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    assert.ok(byName.has('compose_up'), '应暴露 compose_up');
    assert.ok(!byName.has('compose_exec'), '默认不得暴露 compose_exec');

    const up = byName.get('compose_up');
    assert.equal(up.inputSchema.type, 'object');
    assert.equal(up.inputSchema.properties.confirm?.type, 'boolean', '高危工具应带 confirm 开关');
    assert.ok(up.inputSchema.properties.projectId, '应保留原有参数 schema');
    assert.match(up.description, /风险等级:high/, '描述里必须写清风险等级');

    const logs = byName.get('compose_logs');
    assert.equal(logs.inputSchema.properties.confirm, undefined, '低危工具不应要求 confirm');
  } finally {
    await client.close();
  }
});

test('mcp: 高危工具缺少 confirm 时只返回提示不执行', async () => {
  const client = await connectClient();
  try {
    const result = await client.callTool({ name: 'compose_up', arguments: { projectId: 'whatever' } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /confirm=true/, '应提示补 confirm=true 重发');
  } finally {
    await client.close();
  }
});

test('mcp: 未知工具与缺少项目上下文都返回结构化失败', async () => {
  const client = await connectClient();
  try {
    const unknown = await client.callTool({ name: 'not_a_tool', arguments: {} });
    assert.equal(unknown.isError, true);
    assert.match(unknown.content[0].text, /未暴露的工具/);

    const missingProject = await client.callTool({ name: 'compose_up', arguments: { confirm: true } });
    assert.equal(missingProject.isError, true);
    assert.match(missingProject.content[0].text, /"success": false/);
  } finally {
    await client.close();
  }
});

test('mcp: createMcpServer 可独立构造(不依赖 Fastify)', () => {
  const server = createMcpServer({ excluded: ['compose.up'] });
  assert.equal(typeof server.connect, 'function');
  assert.equal(typeof server.close, 'function');
});
