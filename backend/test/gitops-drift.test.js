import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

const tempDir = mkdtempSync(join(tmpdir(), 'composeops-drift-'));
process.env.DB_PATH = join(tempDir, 'test.db');

const { scanRepoDrift, planDriftRepair, scanAllRepoDrift } = await import('../src/services/gitops-drift.js');
const { setSetting } = await import('../src/lib/db.js');

/** 建一个带 compose 文件的全新 git 仓库并返回其路径。 */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'drift-repo-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@test'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir, stdio: 'pipe' });
  writeFileSync(join(dir, 'docker-compose.yml'), 'services:\n  web:\n    image: nginx:1.25\n');
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: dir, stdio: 'pipe' });
  return dir;
}

const baseRepo = () => ({ id: 'r1', name: 'smoke', url: 'file://local', branch: 'main', localPath: makeRepo(), sshKey: null });

test.after(() => rmSync(tempDir, { recursive: true, force: true }));

test('gitops-drift: 未克隆仓库标记 not_cloned 且不报错', async () => {
  const repo = { ...baseRepo(), localPath: mkdtempSync(join(tmpdir(), 'drift-none-')) };
  const drift = await scanRepoDrift(repo);
  assert.equal(drift.status, 'not_cloned');
  assert.deepEqual(drift.drifts, []);
});

test('gitops-drift: 工作区改动被识别为 diverged 且文件名完整', async () => {
  const repo = baseRepo();
  appendFileSync(join(repo.localPath, 'docker-compose.yml'), '# local tweak\n');
  const drift = await scanRepoDrift(repo);
  assert.equal(drift.status, 'diverged');
  assert.equal(drift.drifts.length, 1);
  assert.equal(drift.drifts[0].file, 'docker-compose.yml');
  assert.equal(drift.drifts[0].type, 'modified');
  assert.match(drift.summary, /1 处文件与 Git 不一致/);
});

test('gitops-drift: 干净仓库报告 clean 且无修复步骤', async () => {
  const repo = baseRepo();
  const drift = await scanRepoDrift(repo);
  assert.equal(drift.status, 'clean');
  assert.equal(drift.behind, 0);
  assert.deepEqual(drift.drifts, []);
  const repairs = planDriftRepair(drift);
  assert.equal(repairs[0].action, 'none');
});

test('gitops-drift: 修复计划覆盖三种信号', () => {
  const repairs = planDriftRepair({ detached: true, drifts: [{ type: 'modified', file: 'a.yml' }], behind: 3, branch: 'main' });
  const actions = repairs.map((item) => item.action);
  assert.ok(actions.includes('checkout'));
  assert.ok(actions.includes('commit-or-restore'));
  assert.ok(actions.includes('sync'));
});

test('gitops-drift: 全量扫描对单仓库失败只降级不中断', async () => {
  const good = baseRepo();
  // 通过 setting 注入两条配置:一条正常,一条本地路径非法(相对路径)→ validateLocalPath 抛错
  setSetting('gitops.repositories', JSON.stringify([
    { id: 'good', name: 'good', url: 'file://local', branch: 'main', localPath: good.localPath, sshKey: null },
    { id: 'bad', name: 'broken', url: 'file:///', branch: 'main', localPath: 'relative/not/absolute', sshKey: null },
  ]));
  const result = await scanAllRepoDrift();
  assert.ok(result.repos.length === 2);
  const bad = result.repos.find((item) => item.repoId === 'bad');
  assert.ok(bad, '存在坏仓库记录');
  assert.equal(bad.status, 'error');
  assert.match(bad.summary, /扫描失败/);
  // 好仓库仍然正常扫描
  const goodResult = result.repos.find((item) => item.repoId === 'good');
  assert.ok(goodResult && ['clean', 'diverged', 'behind'].includes(goodResult.status));
});