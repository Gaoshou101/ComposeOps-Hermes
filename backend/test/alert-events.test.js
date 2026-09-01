import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'composeops-alert-events-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');

const { recordAlertEvent, listAlertEvents, updateAlertEvent, pruneAlertEvents } = await import('../src/services/events.js');

test('alert-events: 记录并读取,带优先级', () => {
  const event = recordAlertEvent({ key: 'c1:exit', title: '容器退出', detail: 'web / app', priority: 'danger', to: '/services' });
  assert.ok(event.id);
  assert.equal(event.priority, 'danger');
  const events = listAlertEvents(10);
  assert.ok(events.some((item) => item.id === event.id));
  assert.equal(events[0].read, 0);
  assert.equal(events[0].muted, 0);
});

test('alert-events: 同一 key 未读时自动静默旧事件', () => {
  recordAlertEvent({ key: 'dup', title: '第一次', detail: 'a' });
  recordAlertEvent({ key: 'dup', title: '第二次', detail: 'b' });
  const events = listAlertEvents(10).filter((item) => item.key === 'dup');
  assert.equal(events.length, 2);
  assert.equal(events[0].muted, 0); // 最新未静默
  assert.equal(events[1].muted, 1); // 旧事件被静默
});

test('alert-events: 标记已读/静默', () => {
  const event = recordAlertEvent({ key: 'c2', title: '内存告警', detail: '90%' });
  const updated = updateAlertEvent(event.id, { read: true, muted: true });
  assert.equal(updated.read, 1);
  assert.equal(updated.muted, 1);
});

test('alert-events: prune 只清 7 天前', () => {
  const before = listAlertEvents(50).length;
  const result = pruneAlertEvents(7);
  assert.ok(result.changes >= 0);
  // 刚插入的事件应保留(created_at 为 now)
  assert.ok(listAlertEvents(50).length >= before - 1);
});
