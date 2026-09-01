import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'composeops-ai-sessions-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');

const { addAiMessage, getAiHistory, listAiSessions, clearAiSession, clearAiHistory } = await import('../src/lib/db.js');

test('ai: 会话消息按 sessionId 隔离', () => {
  clearAiHistory();
  addAiMessage('user', '会话A的第一条', null, 1);
  addAiMessage('assistant', '会话A的回答', null, 1);
  addAiMessage('user', '会话B的第一条', null, 2);
  const sessionA = getAiHistory(50, 1);
  const sessionB = getAiHistory(50, 2);
  assert.equal(sessionA.length, 2);
  assert.equal(sessionB.length, 1);
  assert.ok(sessionA.every((message) => message.sessionId === 1));
  assert.ok(sessionB.every((message) => message.sessionId === 2));
});

test('ai: 会话列表聚合标题与消息数', () => {
  clearAiHistory();
  addAiMessage('user', '帮我排查容器启动失败', null, 10);
  addAiMessage('assistant', '检查日志', null, 10);
  addAiMessage('user', '另一个会话', null, 20);
  const sessions = listAiSessions(10);
  assert.ok(sessions.length >= 2);
  const session = sessions.find((item) => item.sessionId === 10);
  assert.ok(session);
  assert.equal(session.messageCount, 2);
  assert.ok(session.title.includes('排查'));
});

test('ai: 删除单个会话不影响其它', () => {
  clearAiHistory();
  addAiMessage('user', 'A1', null, 100);
  addAiMessage('user', 'B1', null, 200);
  clearAiSession(100);
  assert.equal(getAiHistory(50, 100).length, 0);
  assert.equal(getAiHistory(50, 200).length, 1);
});

test('ai: 未指定会话默认进入全局历史', () => {
  clearAiHistory();
  addAiMessage('user', '全局消息');
  const history = getAiHistory(50);
  assert.equal(history.length, 1);
  assert.equal(history[0].sessionId, 0);
});
