import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'composeops-attlogs-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');

const { getAgent } = await import('../src/services/agent.js');
const { createAiSession, getAiHistory, setSetting } = await import('../src/lib/db.js');

const STOP_STREAM = [
  `data: ${JSON.stringify({ choices: [{ delta: { content: '收到' } }] })}\n\n`,
  `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`,
  'data: [DONE]\n\n',
].join('');

test('agent: attachedLogs 以不可信定界块注入 Prompt 且不落入会话历史', async () => {
  setSetting('ai.api_key', 'test-key');
  setSetting('ai.base_url', 'http://ai.test/v1');
  const originalFetch = globalThis.fetch;
  const restoreFetch = () => { globalThis.fetch = originalFetch; };
  let captured;
  globalThis.fetch = async (url, opts) => {
    captured = JSON.parse(opts.body);
    return new Response(STOP_STREAM, { status: 200 });
  };
  try {
    const agent = getAgent();
    const sessionId = createAiSession();
    const events = [];
    const result = await agent.executeWithLoop(
      '看一下这个报错',
      { sessionId, attachedLogs: 'ERROR boom\nINFO started' },
      (event) => events.push(event),
    );
    assert.equal(result.finalContent, '收到');

    const system = captured.messages.find((message) => message.role === 'system');
    const user = captured.messages.at(-1);
    assert.ok(system.content.includes('UNTRUSTED'), '挂载日志时 system 必须带不可信护栏');
    assert.ok(user.content.includes('<<<UNTRUSTED CONTAINER_LOGS#'), '日志必须包进定界块');
    assert.ok(user.content.includes('ERROR boom'));
    assert.ok(user.content.startsWith('看一下这个报错'), '原问题在前,日志只是附件');

    const history = getAiHistory(10, sessionId).filter((item) => item.role === 'user');
    assert.equal(history.at(-1).content, '看一下这个报错', '落库历史只存原问题,不存日志原文');
  } finally {
    restoreFetch();
  }
});
