import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { addColumn, runMigrations } from '../src/lib/db.js';

test('db-migrations: addColumn 幂等——列已存在时返回 false 且不抛错', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY)');
  assert.equal(addColumn(db, 't', 'name', 'TEXT'), true);
  assert.equal(addColumn(db, 't', 'name', 'TEXT'), false);
  assert.equal(db.prepare('PRAGMA table_info(t)').all().filter((c) => c.name === 'name').length, 1);
});

test('db-migrations: runMigrations 对空库应用全部迁移并更新 user_version', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE project_preferences(project_id TEXT PRIMARY KEY);
    CREATE TABLE ai_history(id INTEGER PRIMARY KEY);
    CREATE TABLE alert_events(id INTEGER PRIMARY KEY);
    CREATE TABLE agent_plans(id INTEGER PRIMARY KEY);
  `);
  assert.equal(db.pragma('user_version', { simple: true }), 0);
  const applied = runMigrations(db);
  assert.ok(applied.includes(1));
  assert.equal(db.pragma('user_version', { simple: true }), 1);
  assert.ok(db.prepare('PRAGMA table_info(project_preferences)').all().some((c) => c.name === 'managed'));
  assert.ok(db.prepare('PRAGMA table_info(ai_history)').all().some((c) => c.name === 'session_id'));
});

test('db-migrations: 已应用版本跳过,重放返回空数组', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE project_preferences(project_id TEXT PRIMARY KEY, managed INTEGER, mount_enabled INTEGER);
    CREATE TABLE ai_history(id INTEGER PRIMARY KEY, session_id INTEGER);
    CREATE TABLE alert_events(id INTEGER PRIMARY KEY, logs TEXT);
    CREATE TABLE agent_plans(id INTEGER PRIMARY KEY, rating INTEGER, feedback_text TEXT, feedback_at TEXT);
  `);
  db.pragma('user_version = 1');
  const applied = runMigrations(db);
  assert.deepEqual(applied, []);
  assert.equal(db.pragma('user_version', { simple: true }), 1);
});

test('db-migrations: 真实 user_version=0 历史库(列已在)幂等升到 v1', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mig-legacy-'));
  const dbPath = join(dir, 'legacy.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE project_preferences(project_id TEXT PRIMARY KEY, managed INTEGER, mount_enabled INTEGER);
    CREATE TABLE ai_history(id INTEGER PRIMARY KEY, session_id INTEGER);
    CREATE TABLE alert_events(id INTEGER PRIMARY KEY, logs TEXT);
    CREATE TABLE agent_plans(id INTEGER PRIMARY KEY, rating INTEGER, feedback_text TEXT, feedback_at TEXT);
  `);
  db.pragma('user_version = 0');
  db.close();

  const reopened = new Database(dbPath);
  const applied = runMigrations(reopened);
  assert.ok(applied.includes(1));
  assert.equal(reopened.pragma('user_version', { simple: true }), 1);
  reopened.close();
  rmSync(dir, { recursive: true, force: true });
});

test('db-migrations: 失败的迁移不提交版本号(事务包裹)', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY)');
  const badMigrations = [{ version: 99, name: 'broken', up: () => { throw new Error('fail'); } }];
  assert.throws(() => runMigrations(db, badMigrations), /fail/);
  assert.equal(db.pragma('user_version', { simple: true }), 0);
});
