import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'composeops-metrics-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');

const dbModule = await import('../src/lib/db.js');
const { default: db } = dbModule;
const { queryHistoricalMetrics, getMetricsStats } = await import('../src/services/metrics.js');

test('metrics: 历史指标使用毫秒时间戳并按毫秒窗口过滤', () => {
  db.prepare('DELETE FROM container_metrics').run();
  const now = Date.now();
  const insert = db.prepare('INSERT INTO container_metrics(container_id, metric_type, value, unit, timestamp) VALUES(?, ?, ?, ?, ?)');
  insert.run('container-test', 'cpu', 10, '%', now - 4000);
  insert.run('container-test', 'cpu', 20, '%', now - 2000);
  insert.run('container-test', 'cpu', 30, '%', now);

  const rows = queryHistoricalMetrics({
    containerId: 'container-test',
    metricType: 'cpu',
    startTime: now - 2500,
    endTime: now + 1000,
    aggregation: 0,
  });
  assert.deepEqual(rows.map((row) => row.value), [20, 30]);
  assert.equal(rows[0].timestamp, now - 2000);
  assert.equal(getMetricsStats('container-test', 'cpu', 1).unit, '%');
});
