import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// 独立文件:本进程不配置 MCP_TOKEN,验证端点默认关闭。
// (与 mcp.test.js 分开是为了不动态改写 process.env —— 那会触发 require-atomic-updates。)
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'composeops-mcp-off-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');
delete process.env.MCP_TOKEN;

const { buildApp } = await import('../src/app.js');

const app = await buildApp({ logger: false });
const baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });

test.after(async () => {
  await app.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('mcp: 未配置 MCP_TOKEN 时端点关闭返回 503', async () => {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error, 'mcp_disabled');
  assert.match(body.message, /MCP_TOKEN/);
});
