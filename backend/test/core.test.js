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
const { buildMountPlan, compactMountPaths } = await import('../src/services/mount-plan.js');

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

test('project management is explicit and can be updated as a discovered allowlist', () => {
  assert.equal(database.getProjectPreference('new-project').managed, 0);
  database.setProjectPreference('project-a', { managed: true, favorite: true, note: 'primary' });
  database.setProjectPreference('vanished-project', { managed: true });
  assert.deepEqual(database.getProjectPreference('project-a'), { managed: 1, favorite: 1, note: 'primary' });
  database.setProjectManagement(['project-a', 'project-b'], ['project-b']);
  assert.equal(database.getProjectPreference('project-a').managed, 0);
  assert.equal(database.getProjectPreference('project-b').managed, 1);
  assert.equal(database.getProjectPreference('vanished-project').managed, 0);
  assert.equal(database.exportUserData().projectPreferences.find((item) => item.projectId === 'project-b').managed, 1);
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

test('mount plan deduplicates exact paths without broadening permissions', () => {
  assert.deepEqual(compactMountPaths([
    '/srv/compose/app-a',
    '/srv/compose/app-a/worker',
    '/opt/app-b',
    '/opt/app-b',
    'relative/path',
  ]), ['/opt/app-b', '/srv/compose/app-a']);

  const projects = [
    { id: 'a', projectName: 'app-a', owner: 'Personal', workingDir: '/srv/compose/app-a', composeFiles: ['/srv/compose/app-a/compose.yml'], managed: true, mounted: false, editable: false, mountState: 'directory_unreachable', containers: [{}] },
    { id: 'b', projectName: 'app-b', owner: 'Personal', workingDir: '/srv/compose/app-b', composeFiles: ['/srv/compose/app-b/compose.yml'], managed: true, mounted: false, editable: false, mountState: 'directory_unreachable', containers: [{}] },
    { id: 'c', projectName: 'ready', owner: 'Personal', workingDir: '/srv/compose/ready', composeFiles: ['/srv/compose/ready/compose.yml'], managed: true, mounted: true, editable: true, mountState: 'ready', containers: [{}] },
    { id: 'd', projectName: 'legacy', owner: 'Personal', workingDir: '', composeFiles: [], managed: true, mounted: false, editable: false, mountState: 'metadata_missing', containers: [] },
    { id: 'e', projectName: 'stale', owner: 'Personal', workingDir: '/srv/stale', composeFiles: ['/srv/stale/missing.yml'], managed: true, mounted: false, editable: false, mountState: 'compose_files_unreachable', containers: [] },
    { id: 'f', projectName: 'unmanaged', owner: 'Personal', workingDir: '/srv/unmanaged', composeFiles: ['/srv/unmanaged/compose.yml'], managed: false, mounted: false, editable: false, mountState: 'directory_unreachable', containers: [] },
  ];
  const plan = buildMountPlan(projects);
  assert.deepEqual(plan.summary, { total: 6, managed: 5, operable: 1, unmanaged: 1, pending: 2, unsupported: 2 });
  assert.equal(plan.projects.find((item) => item.id === 'f').managed, false);
  assert.deepEqual(plan.mounts.map((item) => item.path), ['/srv/compose/app-a', '/srv/compose/app-b']);
  assert.doesNotMatch(plan.composeSnippet, /unmanaged/);
  assert.equal(plan.parentSuggestions[0].path, '/srv/compose');
  assert.match(plan.composeSnippet, /source: "\/srv\/compose\/app-a"/);
  assert.doesNotMatch(plan.composeSnippet, /source: "\/srv\/compose"\n/);
  assert.equal(plan.recreateCommand, 'docker compose up -d --force-recreate opsdash');
});
