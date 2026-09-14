import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'composeops-agent-feedback-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');

const { createAgentPlan, recordAgentFeedback, listAgentFeedback, updateAgentPlan } = await import('../src/lib/db.js');

test('agent: 反馈写回 agent_plans 并被反馈列表聚合', () => {
  const planId = createAgentPlan(1, '重启 nginx 服务', { role: 'planner', steps: [] });
  assert.equal(listAgentFeedback(50).some((row) => row.id === planId), false, '未反馈前不应出现在反馈列表');

  const updated = recordAgentFeedback(planId, 5, '回答准确');
  assert.equal(updated.rating, 5);
  assert.equal(updated.feedback_text, '回答准确');
  const rows = listAgentFeedback(50);
  const row = rows.find((item) => item.id === planId);
  assert.ok(row, '反馈后应出现在反馈列表');
  assert.equal(row.rating, 5);
});

test('agent: 反馈评分夹紧到 1..5 且对不存在的计划返回 null', () => {
  const planId = createAgentPlan(2, '查看容器状态', { role: 'planner', steps: [] });
  assert.equal(recordAgentFeedback(planId, 99).rating, 5, '超上限应夹到 5');
  assert.equal(recordAgentFeedback(planId, -3).rating, 1, '低于下限应夹到 1');
  assert.equal(recordAgentFeedback(999999, 5), null, '不存在的计划应返回 null');
});

test('agent: 反馈文本被截断到 2000 字符', () => {
  const planId = createAgentPlan(3, '分析日志', { role: 'planner', steps: [] });
  const updated = recordAgentFeedback(planId, 1, 'x'.repeat(3000));
  assert.equal(updated.feedback_text.length, 2000);
  updateAgentPlan(planId, { status: 'completed' });
});
