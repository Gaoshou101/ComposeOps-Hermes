import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'composeops-workflow-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');

const {
  createDefinition, listDefinitions, getDefinition, removeDefinition,
  startWorkflow, getInstance, approveInstance,
} = await import('../src/services/workflow-engine.js');

test('workflow: 创建定义并校验节点', () => {
  const definition = createDefinition({
    name: '故障处理',
    description: '自动诊断与审批',
    nodes: [
      { id: 'trigger', type: 'trigger', config: {} },
      { id: 'agent', type: 'agent', config: { prompt: '分析日志' } },
      { id: 'approval', type: 'approval', config: {} },
      { id: 'action', type: 'action', config: { action: 'restart' } },
    ],
  });
  assert.ok(definition.id);
  assert.equal(definition.nodes.length, 4);
  assert.ok(listDefinitions().some((d) => d.id === definition.id));
});

test('workflow: 非法节点类型被拒绝', () => {
  assert.throws(() => createDefinition({ name: 'bad', nodes: [{ id: 'x', type: 'unknown' }] }), /未知节点类型/);
});

test('workflow: 启动实例,审批前停在 waiting_approval', async () => {
  const definition = createDefinition({
    name: '审批流',
    nodes: [
      { id: 'trigger', type: 'trigger', config: {} },
      { id: 'approval', type: 'approval', config: {} },
      { id: 'action', type: 'action', config: { action: 'deploy' } },
    ],
  });
  const instance = startWorkflow(definition.id, { project: 'web' });
  assert.ok(instance.id);
  // 等待异步执行到 approval 节点
  await new Promise((resolve) => setTimeout(resolve, 50));
  const pending = getInstance(instance.id);
  assert.equal(pending.status, 'waiting_approval');
  assert.ok(pending.steps.some((step) => step.nodeType === 'approval' && step.status === 'waiting_approval'));
});

test('workflow: 审批通过后继续执行到完成', async () => {
  const definition = createDefinition({
    name: '审批流2',
    nodes: [
      { id: 'trigger', type: 'trigger', config: {} },
      { id: 'approval', type: 'approval', config: {} },
      { id: 'action', type: 'action', config: { action: 'deploy' } },
    ],
  });
  const instance = startWorkflow(definition.id, {});
  await new Promise((resolve) => setTimeout(resolve, 50));
  const pending = getInstance(instance.id);
  assert.equal(pending.status, 'waiting_approval');

  const approved = approveInstance(instance.id, { approved: true, note: '同意' });
  assert.equal(approved.status, 'running');
  await new Promise((resolve) => setTimeout(resolve, 50));
  const done = getInstance(instance.id);
  assert.equal(done.status, 'success');
  assert.ok(done.steps.some((step) => step.nodeType === 'action' && step.status === 'success'));
});

test('workflow: 拒绝审批则取消', async () => {
  const definition = createDefinition({
    name: '审批流3',
    nodes: [
      { id: 'trigger', type: 'trigger', config: {} },
      { id: 'approval', type: 'approval', config: {} },
    ],
  });
  const instance = startWorkflow(definition.id, {});
  await new Promise((resolve) => setTimeout(resolve, 50));
  const cancelled = approveInstance(instance.id, { approved: false });
  assert.equal(cancelled.status, 'cancelled');
});

test('workflow: 删除定义', () => {
  const definition = createDefinition({ name: '待删', nodes: [{ id: 't', type: 'trigger', config: {} }] });
  assert.ok(removeDefinition(definition.id));
  assert.equal(getDefinition(definition.id), null);
});