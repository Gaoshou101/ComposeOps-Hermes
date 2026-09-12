import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'composeops-volbackup-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');

const { parseProjectVolumes } = await import('../src/services/volume-backup.js');
const db = (await import('../src/lib/db.js')).default;
const {
  addVolumeBackup, pruneVolumeBackups, pruneAiData,
  getVolumeBackup, deleteVolumeBackupRow,
  createAiSession, addAiMessage, createAgentPlan, recordAgentExecution,
} = await import('../src/lib/db.js');

test('volume-backup: parseProjectVolumes 区分命名卷/bind/变量引用', () => {
  const compose = `
services:
  web:
    image: nginx
    volumes:
      - "web-data:/var/www"
      - "./site:/usr/share/nginx/html"
      - "/etc/localtime:/etc/localtime:ro"
      - "$DATA_DIR/cache:/cache"
      - type: bind
        source: ./config
        target: /config
      - type: tmpfs
        target: /tmpfs
  api:
    image: api
    volumes:
      - web-data:/shared
volumes:
  web-data:
  external-vol:
    external: true
`;
  const { volumes, error } = parseProjectVolumes(compose);
  assert.equal(error, '');
  const byName = new Map(volumes.map((item) => [item.name, item]));
  assert.equal(byName.get('web-data').skip, '');
  assert.equal(byName.get('external-vol').external, true);
  assert.ok(byName.get('./site').skip.includes('bind mount'));
  assert.ok(byName.get('/etc/localtime').skip.includes('bind mount'));
  assert.ok(byName.get('$DATA_DIR/cache').skip.includes('变量引用'));
  assert.ok(byName.get('./config').skip.includes('bind mount'));
  assert.ok(!byName.has('/tmpfs'), 'tmpfs 无持久数据,不产生条目');
});

test('volume-backup: parseProjectVolumes 容忍空内容与非法 YAML', () => {
  assert.deepEqual(parseProjectVolumes(''), { volumes: [], error: '' });
  assert.ok(parseProjectVolumes('- [a, b').error.includes('YAML'));
});

test('volume-backup: 同卷超限清理返回应删记录', () => {
  for (let index = 0; index < 25; index += 1) {
    addVolumeBackup({ projectId: 'p1', projectName: 'demo', volume: 'data', file: `demo_data_${index}.tar.gz`, bytes: index, host: 'local' });
  }
  const stale = pruneVolumeBackups('p1', 'data', 20);
  assert.equal(stale.length, 5);
  assert.ok(stale.every((item) => /demo_data_[0-4]\./.test(item.file)), '应清理最旧的 5 份');
  for (const item of stale) deleteVolumeBackupRow(item.id);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM volume_backups WHERE project_id = 'p1'").get().c, 20);
  assert.equal(getVolumeBackup(1), null, '最旧的记录应被清理');
  assert.ok(getVolumeBackup(25));
  deleteVolumeBackupRow(25);
});

test('retention: pruneAiData 按保留天数清理会话与 Agent 审计', () => {
  const sessionId = createAiSession();
  addAiMessage('user', '很久之前的提问', null, sessionId);
  db.prepare("UPDATE ai_history SET created_at = datetime('now', '-100 days')").run();
  const planId = createAgentPlan(sessionId, '旧计划', { steps: [] });
  db.prepare("UPDATE agent_plans SET created_at = datetime('now', '-100 days') WHERE id = ?").run(planId);
  recordAgentExecution(planId, 'compose.ps', {}, 'success');
  const freshSession = createAiSession();
  addAiMessage('user', '今天的提问', null, freshSession);

  const result = pruneAiData(90);
  assert.ok(result.history >= 1);
  assert.ok(result.plans >= 1);
  const remainingHistory = db.prepare('SELECT content FROM ai_history ORDER BY id').all().map((row) => row.content);
  assert.deepEqual(remainingHistory, ['今天的提问']);
  const remainingPlans = db.prepare('SELECT COUNT(*) c FROM agent_plans').get().c;
  assert.equal(remainingPlans, 0);
});
