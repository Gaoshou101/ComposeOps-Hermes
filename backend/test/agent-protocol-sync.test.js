import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('agent-protocol-core: 前后端副本字节一致(dotenv 同一约定)', () => {
  const backendCopy = readFileSync(path.join(__dirname, '../src/lib/agent-protocol-core.js'));
  const frontendCopy = readFileSync(path.join(__dirname, '../../frontend/src/lib/agent-protocol-core.js'));
  assert.deepEqual(backendCopy, frontendCopy, 'agent-protocol-core.js 两份副本不一致,修改时必须两处同步');
});
