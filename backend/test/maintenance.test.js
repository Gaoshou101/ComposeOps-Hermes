import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'composeops-maintenance-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');

const db = (await import('../src/lib/db.js')).default;
const {
  pruneComposeBackups,
  runDataMaintenance,
  pruneDataHistory,
} = await import('../src/services/maintenance.js');

test('pruneOperationHistory 删除超过保留天数的操作记录', () => {
  db.prepare('DELETE FROM operation_history').run();
  db.prepare("INSERT INTO operation_history(project_id, project_name, action, status, created_at) VALUES('p1','P1','up','success', datetime('now','-5 days'))").run();
  db.prepare("INSERT INTO operation_history(project_id, project_name, action, status, created_at) VALUES('p2','P2','down','success', datetime('now','-45 days'))").run();

  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM operation_history').get().c, 2);
  const pruned = db.prepare("DELETE FROM operation_history WHERE julianday(created_at) < julianday('now','-30 days')").run();
  assert.equal(pruned.changes, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM operation_history').get().c, 1);
});

test('pruneAiHistory 清理超过保留天数的 AI 历史', () => {
  db.prepare('DELETE FROM ai_history').run();
  db.prepare("INSERT INTO ai_history(role, content, created_at) VALUES('user','old', datetime('now','-45 days'))").run();
  db.prepare("INSERT INTO ai_history(role, content, created_at) VALUES('user','new', datetime('now'))").run();

  const pruned = pruneDataHistory({ aiHistoryDays: 30 });
  assert.equal(pruned.aiHistoryDeleted, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM ai_history').get().c, 1);
});

test('pruneComposeBackups 每个项目只保留最新 N 份', () => {
  db.prepare('DELETE FROM compose_backups').run();
  const insertBackup = (projectId, filePath) => db.prepare(
    "INSERT INTO compose_backups(project_id, file_path, content) VALUES(?, ?, 'x')"
  ).run(projectId, filePath);

  insertBackup('pa', 'a1'); insertBackup('pa', 'a2'); insertBackup('pa', 'a3');
  insertBackup('pb', 'b1');

  const pruned = pruneComposeBackups(2);
  assert.equal(pruned.changes, 1); // pa 留 2 删 1,pb 留 1 删 0
  const remaining = db.prepare('SELECT project_id, file_path FROM compose_backups ORDER BY file_path').all();
  assert.deepEqual(remaining.map((r) => r.file_path), ['a2', 'a3', 'b1']);
});

test('runDataMaintenance 幂等且返回各表删除计数', () => {
  db.prepare('DELETE FROM ai_history').run();
  db.prepare('DELETE FROM operation_history').run();
  db.prepare("INSERT INTO ai_history(role, content, created_at) VALUES('user','old', datetime('now','-40 days'))").run();
  db.prepare("INSERT INTO operation_history(project_id, action, status, created_at) VALUES('p9','up','success', datetime('now','-60 days'))").run();

  const result = runDataMaintenance();
  assert.equal(typeof result.agentPlansDeleted, 'number');
  assert.equal(typeof result.operationHistoryDeleted, 'number');
  assert.equal(result.aiHistoryDeleted >= 1, true);
  assert.equal(typeof result.composeBackupsDeleted, 'number');

  const second = runDataMaintenance();
  assert.equal(typeof second.agentPlansDeleted, 'number');
});

test('pruneAgentPlans 通过 CASCADE 联删子表 executions', () => {
  db.prepare('DELETE FROM agent_plans').run();
  db.prepare("INSERT INTO agent_plans(id, session_id, user_message, plan_json, status, created_at) VALUES('plan-old',0,'m','{}','completed', datetime('now','-40 days'))").run();
  db.prepare("INSERT INTO agent_executions(id, plan_id, tool_name, status, created_at) VALUES('e1','plan-old','compose.up','success', datetime('now','-40 days'))").run();

  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM agent_plans').get().c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM agent_executions').get().c, 1);

  const pruned = db.prepare("DELETE FROM agent_plans WHERE julianday('now') - julianday(created_at) > 30").run();
  assert.equal(pruned.changes, 1);
  // CASCADE:executions 应被连带删除
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM agent_executions').get().c, 0);
});
