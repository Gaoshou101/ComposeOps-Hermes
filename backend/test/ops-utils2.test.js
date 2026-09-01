import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'composeops-five-feats-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');

const { classifyPorts, pickWebPorts, scanProjectWebPorts, buildWebUiLinks } = await import('../src/services/project-ports.js');
const { detectDbType, envToDbConfig, buildDumpCommand } = await import('../src/services/db-dumper.js');
const { parseField, validateCron, nextRunTime } = await import('../src/services/cron-scheduler.js');

test('project-ports: 过滤数据端口并优先 Web 典型端口', () => {
  const { candidates } = classifyPorts({ ports: [
    { public: 8080, private: 80 },
    { public: 5432, private: 5432 },
    { public: 3306, private: 3306 },
  ] });
  assert.deepEqual(candidates, [8080]);
  const picked = pickWebPorts(candidates);
  assert.deepEqual(picked, [8080]);
});

test('project-ports: 数据库镜像不暴露 WebUI', () => {
  const { isDatabase } = classifyPorts({ image: 'postgres:16', ports: [{ public: 5432, private: 5432 }] });
  assert.equal(isDatabase, true);
  const entries = scanProjectWebPorts({ containers: [{ id: 'c1', name: 'db', image: 'mysql:8', state: 'running', ports: [{ public: 3306, private: 3306 }] }] });
  assert.deepEqual(entries, []);
});

test('project-ports: 多端口按典型端口排序并生成直达链接', () => {
  const entries = scanProjectWebPorts({ containers: [
    { id: 'c1', name: 'web', image: 'nginx', state: 'running', ports: [{ public: 5000, private: 80 }, { public: 8080, private: 80 }] },
  ] });
  assert.equal(entries[0].ports[0], 8080);
  const links = buildWebUiLinks('192.168.1.10:3001', entries);
  assert.equal(links[0].ports[0].url, 'http://192.168.1.10:8080');
});

test('db-dumper: 识别数据库镜像类型', () => {
  assert.equal(detectDbType('postgres:16'), 'postgres');
  assert.equal(detectDbType('mariadb:11'), 'mariadb');
  assert.equal(detectDbType('mysql:8'), 'mysql');
  assert.equal(detectDbType('redis:7'), 'redis');
  assert.equal(detectDbType('mongo:7'), 'mongo');
  assert.equal(detectDbType('nginx'), null);
});

test('db-dumper: 从 .env 提取数据库凭据', () => {
  const config = envToDbConfig([
    { key: 'POSTGRES_USER', value: 'admin' },
    { key: 'POSTGRES_PASSWORD', value: 's3cret' },
    { key: 'POSTGRES_DB', value: 'mydb' },
  ]);
  assert.deepEqual(config, { user: 'admin', password: 's3cret', db: 'mydb', redisPassword: '' });
});

test('db-dumper: PostgreSQL dump 命令带 PGPASSWORD 环境变量', () => {
  const { cmd, env } = buildDumpCommand('postgres', { user: 'admin', password: 's3cret', db: 'mydb' });
  assert.deepEqual(cmd, ['pg_dump', '--no-owner', '--no-acl', '-U', 'admin', '-d', 'mydb']);
  assert.ok(env.includes('PGPASSWORD=s3cret'));
});

test('db-dumper: MySQL dump 命令用 MYSQL_PWD 防密码泄漏', () => {
  const { cmd, env } = buildDumpCommand('mysql', { user: 'root', password: 'p@ss', db: 'app' });
  assert.ok(env.includes('MYSQL_PWD=p@ss'));
  assert.ok(cmd.includes('--single-transaction'));
});

test('cron: 校验合法/非法表达式', () => {
  assert.equal(validateCron('0 3 * * *'), true);
  assert.throws(() => validateCron('0 61 * * *'), /无效的 cron 字段/);
  assert.throws(() => validateCron('0 3 * *'), /5 段/);
});

test('cron: 解析字段步进与范围', () => {
  const minute = parseField('*/15', 0, 59);
  assert.equal(minute(0), true);
  assert.equal(minute(15), true);
  assert.equal(minute(14), false);
  const hour = parseField('9-17', 0, 23);
  assert.equal(hour(9), true);
  assert.equal(hour(12), true);
  assert.equal(hour(18), false);
});

test('cron: 计算下一次执行(每天 3 点)', () => {
  const next = nextRunTime('0 3 * * *', new Date('2026-08-30T10:00:00+08:00'));
  assert.ok(next.getTime() > new Date('2026-08-30T10:00:00+08:00').getTime());
  assert.equal(next.getHours(), 3);
});
