import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'composeops-test-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');

const auth = await import('../src/lib/auth.js');
const database = await import('../src/lib/db.js');
const { composeArgs, resolveProjectFile } = await import('../src/services/compose-runner.js');
const { parseYaml, validateYaml } = await import('../src/lib/files.js');
const { demuxStream } = await import('../src/lib/docker-streams.js');

test('passwords are hashed and sessions are authenticated by cookie', () => {
  assert.throws(() => auth.setPassword('short'), /至少需要 10/);
  auth.setPassword('correct-horse-battery');
  assert.equal(auth.verifyPassword('correct-horse-battery'), true);
  assert.equal(auth.verifyPassword('wrong-password'), false);

  let cookie = '';
  auth.issueSession({ header(name, value) { if (name === 'Set-Cookie') cookie = value; } });
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.equal(auth.isAuthenticated({ headers: { cookie: cookie.split(';')[0] } }), true);
  auth.changePassword('correct-horse-battery', 'new-correct-horse-battery');
  assert.equal(auth.isAuthenticated({ headers: { cookie: cookie.split(';')[0] } }), false);
  assert.equal(auth.verifyPassword('new-correct-horse-battery'), true);
});

test('compose actions map to fixed argument lists', () => {
  const project = { composeFiles: ['/srv/app/compose.yml', '/srv/app/compose.prod.yml'] };
  assert.deepEqual(composeArgs(project, 'up'), [
    'compose', '-f', '/srv/app/compose.yml', '-f', '/srv/app/compose.prod.yml', 'up', '-d',
  ]);
  assert.deepEqual(composeArgs(project, 'restart'), [
    'compose', '-f', '/srv/app/compose.yml', '-f', '/srv/app/compose.prod.yml', 'restart',
  ]);
  assert.throws(() => composeArgs(project, 'exec'), /不支持/);
});

test('project file validation rejects symlinks escaping the project root', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'composeops-root-'));
  const outside = path.join(tempDir, 'outside.yml');
  fs.writeFileSync(outside, 'services: {}\n');
  const linked = path.join(root, 'compose.yml');
  fs.symlinkSync(outside, linked);
  await assert.rejects(
    resolveProjectFile({ workingDir: root, composeFiles: [linked] }, 0),
    /不在项目目录内/
  );
});

test('exports and imports exclude credentials', () => {
  database.setSetting('ai.api_key', 'secret-key');
  database.setSetting('notifications.config', JSON.stringify({ token: 'secret-token' }));
  database.setSetting('ai.model', 'model-a');
  const exported = database.exportUserData();
  assert.equal(exported.settings['ai.api_key'], undefined);
  assert.equal(exported.settings['notifications.config'], undefined);
  database.importUserData({ settings: { 'ai.model': 'model-b', 'auth.password_hash': 'bad' } });
  assert.equal(database.getSetting('ai.model'), 'model-b');
  assert.notEqual(database.getSetting('auth.password_hash'), 'bad');
});

test('YAML validation rejects malformed documents', () => {
  assert.deepEqual(parseYaml('services:\n  web:\n    image: nginx\n'), { services: { web: { image: 'nginx' } } });
  assert.equal(validateYaml('services: {}\n'), true);
  assert.throws(() => validateYaml('services: [\n'), /flow sequence|YAML/i);
});

test('Docker multiplexed streams survive fragmented frames', async () => {
  const demux = demuxStream();
  const stdout = [];
  const stderr = [];
  demux.stdout.on('data', (chunk) => stdout.push(chunk));
  demux.stderr.on('data', (chunk) => stderr.push(chunk));

  function frame(type, text) {
    const payload = Buffer.from(text);
    const header = Buffer.alloc(8);
    header[0] = type;
    header.writeUInt32BE(payload.length, 4);
    return Buffer.concat([header, payload]);
  }
  const input = Buffer.concat([frame(1, 'hello'), frame(2, 'failure')]);
  demux.write(input.subarray(0, 3));
  demux.write(input.subarray(3, 12));
  demux.end(input.subarray(12));
  await Promise.all([
    new Promise((resolve) => demux.stdout.on('end', resolve)),
    new Promise((resolve) => demux.stderr.on('end', resolve)),
  ]);
  assert.equal(Buffer.concat(stdout).toString(), 'hello');
  assert.equal(Buffer.concat(stderr).toString(), 'failure');
});
