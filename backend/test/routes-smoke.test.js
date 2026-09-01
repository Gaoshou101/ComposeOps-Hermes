import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'composeops-routes-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');

const { buildApp } = await import('../src/app.js');

// 整个文件共用一个实例:buildApp 不监听端口,inject() 直接走 Fastify 内部管线。
const app = await buildApp({ logger: false });
await app.ready();

test.after(async () => {
  await app.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('routes: 未登录访问受保护端点返回 401', async () => {
  for (const url of ['/api/v1/services', '/api/v1/projects', '/api/v1/ai/config', '/api/v1/system/df']) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 401, `${url} 应要求登录`);
    assert.equal(response.json().error, 'unauthorized');
  }
});

test('routes: 公开认证端点无需登录即可访问', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/v1/auth/status' });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(typeof body.setupRequired, 'boolean');
  assert.equal(body.authenticated, false);
});

test('routes: 带查询串的公开端点不被误判为受保护路径', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/v1/auth/status?ts=123' });
  assert.equal(response.statusCode, 200);
});

test('routes: 跨站来源的写请求被 origin 校验拒绝', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin: 'https://evil.example.com', host: 'localhost:3001' },
    payload: { password: 'whatever' },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error, 'origin_rejected');
});

test('routes: 同源写请求通过 origin 校验(进入业务逻辑而非 403)', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin: 'http://localhost:3001', host: 'localhost:3001' },
    payload: { password: 'wrong-password-but-same-origin' },
  });
  assert.notEqual(response.statusCode, 403);
});

test('routes: WebSocket 路径同样受认证边界保护', async () => {
  const response = await app.inject({ method: 'GET', url: '/ws/logs' });
  assert.equal(response.statusCode, 401);
});

test('routes: 所有响应都带上安全响应头', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/v1/auth/status' });
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['x-frame-options'], 'DENY');
  assert.equal(response.headers['referrer-policy'], 'no-referrer');
  assert.match(response.headers['content-security-policy'], /default-src 'self'/);
  assert.match(response.headers['permissions-policy'], /camera=\(\)/);
});

test('routes: /health 无需登录,按 Docker 可用性返回 200 或 503', async () => {
  const response = await app.inject({ method: 'GET', url: '/health' });
  assert.ok([200, 503].includes(response.statusCode), `意外状态码 ${response.statusCode}`);
  const body = response.json();
  assert.equal(typeof body.latencyMs, 'number');
  if (response.statusCode === 200) {
    assert.equal(body.status, 'ok');
    assert.equal(body.docker, 'ok');
  } else {
    assert.equal(body.status, 'degraded');
    assert.equal(body.docker, 'unreachable');
  }
});

test('routes: 未注册路径返回 404 而不是 401', async () => {
  const response = await app.inject({ method: 'GET', url: '/definitely-not-a-route' });
  assert.equal(response.statusCode, 404);
});
