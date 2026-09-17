import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'composeops-cmdb-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');

const {
  upsertAsset, getAsset, listAssets, deleteAsset,
  addAssetRelation, listAssetRelations,
} = await import('../src/lib/db.js');

test('cmdb: 资产 upsert 幂等', () => {
  const asset = upsertAsset({ id: 'host:local', kind: 'host', name: 'local', displayName: 'Local Daemon', status: 'online' });
  assert.equal(asset.id, 'host:local');
  assert.equal(asset.kind, 'host');
  // 再次 upsert 更新状态
  const updated = upsertAsset({ id: 'host:local', kind: 'host', name: 'local', displayName: 'Local Daemon', status: 'offline' });
  assert.equal(updated.status, 'offline');
  assert.equal(listAssets({ kind: 'host' }).length, 1);
});

test('cmdb: 资产关系建立与查询', () => {
  upsertAsset({ id: 'project:web', kind: 'project', name: 'web', displayName: 'Web' });
  upsertAsset({ id: 'container:c1', kind: 'container', name: 'c1', displayName: 'c1' });
  addAssetRelation('container:c1', 'project:web', 'runs_on');
  const relations = listAssetRelations();
  assert.ok(relations.some((r) => r.sourceId === 'container:c1' && r.targetId === 'project:web' && r.relation === 'runs_on'));
});

test('cmdb: 删除资产', () => {
  upsertAsset({ id: 'project:temp', kind: 'project', name: 'temp' });
  assert.ok(getAsset('project:temp'));
  assert.ok(deleteAsset('project:temp'));
  assert.equal(getAsset('project:temp'), null);
});