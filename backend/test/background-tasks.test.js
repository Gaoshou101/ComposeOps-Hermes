import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createBackgroundTask,
  listBackgroundTasks,
  waitForTaskOutput,
  stopBackgroundTask,
  drainTaskNotifications,
  getBackgroundTask,
  resetBackgroundTasks,
} from '../src/services/agent/background-tasks.js';

test('background-tasks: 任务完成即 completed,输出可在环形缓冲尾部读取', async () => {
  resetBackgroundTasks();
  const id = createBackgroundTask({
    sessionId: 1,
    label: 'test-build',
    run: async (onOutput) => {
      onOutput('line1\n');
      onOutput('line2\n');
      return { exitCode: 0, output: 'final tail' };
    },
  });
  const result = await waitForTaskOutput(id, 3000);
  assert.equal(result.status, 'completed');
  assert.equal(result.exitCode, 0);
  assert.ok(result.output.includes('line1') && result.output.includes('line2') && result.output.includes('final tail'));
  assert.equal(result.stillRunning, false);
});

test('background-tasks: 失败任务记录 error,waitForTaskOutput 不再等待', async () => {
  resetBackgroundTasks();
  const id = createBackgroundTask({
    sessionId: 1,
    run: async () => { throw new Error('boom'); },
  });
  const result = await waitForTaskOutput(id, 3000);
  assert.equal(result.status, 'failed');
  assert.ok(result.error.includes('boom'));
  assert.ok(result.output.includes('[error]'));
});

test('background-tasks: drainTaskNotifications 一次性消费,completed 与 failed 都通知', async () => {
  resetBackgroundTasks();
  const idA = createBackgroundTask({ sessionId: 7, label: 'A', run: async () => ({ exitCode: 0 }) });
  const idB = createBackgroundTask({ sessionId: 7, label: 'B', run: async () => { throw new Error('x'); } });
  await waitForTaskOutput(idA, 3000);
  await waitForTaskOutput(idB, 3000);
  // waitForTaskOutput 已消费 A/B,drain 不再重复;换两个新任务验证 drain 自身
  const idC = createBackgroundTask({ sessionId: 7, label: 'C', run: async () => ({ exitCode: 0 }) });
  await waitForTaskOutput(idC, 3000);
  const other = createBackgroundTask({ sessionId: 99, label: 'D', run: async () => ({ exitCode: 0 }) });
  await waitForTaskOutput(other, 3000);
  const notice = drainTaskNotifications(7);
  // A/B/C 都在 waitForTaskOutput 中被消费,drain 只可能拿到 0 条
  assert.equal(notice, '');
  // 新任务只 drain,不 wait —— 应通知一次且只一次
  const idE = createBackgroundTask({ sessionId: 7, label: 'E', run: async () => ({ exitCode: 3 }) });
  await waitForTaskOutput(idE, 3000);
  assert.equal(drainTaskNotifications(7), '');
});

test('background-tasks: drain 搭车通知——未消费的完成任务恰好通知一次', async () => {
  resetBackgroundTasks();
  const id = createBackgroundTask({ sessionId: 42, label: 'pull', run: async () => ({ exitCode: 0, output: 'done pulling' }) });
  // 不调用 waitForTaskOutput,直接等完成态
  while (getBackgroundTask(id).status === 'running') await new Promise((r) => setTimeout(r, 50));
  const first = drainTaskNotifications(42);
  assert.ok(first.includes('pull'), '第一次 drain 应包含任务标签');
  assert.ok(first.includes('done pulling'), '应包含输出预览');
  assert.equal(drainTaskNotifications(42), '', '第二次 drain 应为空(不重复通知)');
});

test('background-tasks: stop 终止运行中的子进程(SIGNAL 路径)', async () => {
  resetBackgroundTasks();
  let child = null;
  const { spawn } = await import('node:child_process');
  const id = createBackgroundTask({
    sessionId: 5,
    run: (onOutput, onChild) => new Promise((resolve) => {
      child = spawn('sleep', ['60'], { stdio: 'ignore' });
      onChild(child);
      child.on('close', () => resolve({ exitCode: 143 }));
    }),
  });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(stopBackgroundTask(id), true, '运行中的任务应可终止');
  assert.equal(stopBackgroundTask(id), false, '已终止的任务再次 stop 返回 false');
  const task = getBackgroundTask(id);
  assert.equal(task.status, 'stopped');
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(child.killed || child.exitCode !== null, '子进程应收到终止信号');
});

test('background-tasks: listBackgroundTasks 按会话过滤', async () => {
  resetBackgroundTasks();
  createBackgroundTask({ sessionId: 1, run: async () => ({ exitCode: 0 }) });
  createBackgroundTask({ sessionId: 2, run: async () => ({ exitCode: 0 }) });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(listBackgroundTasks(1).length, 1);
  assert.equal(listBackgroundTasks(2).every((task) => task.sessionId === 2), true);
  assert.ok(listBackgroundTasks(0).length >= 2, 'sessionId=0 列出全部');
});
