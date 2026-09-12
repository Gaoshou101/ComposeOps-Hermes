import test from 'node:test';
import assert from 'node:assert/strict';
import { toPublicAgentEvent } from '../src/lib/agent-public-events.js';

test('公开 Agent 事件隐藏工具协议和内部工具字段', () => {
  assert.equal(toPublicAgentEvent({ type: 'trace', trace: { content: 'tool_call secret' } }), null);
  // token 分片必须在 ai.js 发射层(全量、有状态)完成协议剥离后原样透传:
  // 逐 token 清洗会吃掉分片边界的空白与换行,造成表格/代码块与正文粘连、英文空格丢失。
  assert.deepEqual(toPublicAgentEvent({ type: 'token', content: '回答 \n\n| 项目 | 状态 |' }), { type: 'token', content: '回答 \n\n| 项目 | 状态 |' });
  assert.deepEqual(toPublicAgentEvent({ type: 'token', content: '' }), { type: 'token', content: '' });
  assert.deepEqual(toPublicAgentEvent({ type: 'token' }), { type: 'token', content: '' });
  // done 是完整文本,仍做协议与内部伪代码清洗。
  assert.deepEqual(toPublicAgentEvent({ type: 'done', content: '结论 如下:\n\n\ntext tool_ca' }), { type: 'done', content: '结论 如下:\n\ntext' });
  assert.deepEqual(toPublicAgentEvent({ type: 'token', content: 'iNdEx++ result= composeOps.project.list_managed()project_list<tID | 项目名称 |\n您当前可以操作的项目如下:' }), { type: 'token', content: 'iNdEx++ result= composeOps.project.list_managed()project_list<tID | 项目名称 |\n您当前可以操作的项目如下:' });
  assert.deepEqual(toPublicAgentEvent({
    type: 'confirmation_required',
    tool: 'cron.create',
    params: { password: 'hidden' },
    executionId: 12,
    toolCallId: 'call-1',
    description: '创建定时任务',
  }), { type: 'confirmation_required', executionId: '12', toolCallId: 'call-1', description: '创建定时任务' });
});

test('公开 Agent 事件保留用户需要的上下文和完成通知', () => {
  assert.deepEqual(toPublicAgentEvent({ type: 'tool_result', tool: 'project.list_managed', result: { result: [{ id: 'p1' }] } }), {
    type: 'context_data', kind: 'projects', projects: [{ id: 'p1' }],
  });
  assert.deepEqual(toPublicAgentEvent({ type: 'tool_result', tool: 'cron.create', result: { result: { name: 'backup' } } }), {
    type: 'action_completed', kind: 'cron_created', result: { name: 'backup' },
  });
  // 通用工具结果只透出工具名/成败/耗时,结果体不外带
  assert.deepEqual(toPublicAgentEvent({ type: 'tool_result', tool: 'compose.ps', result: { success: true, result: {}, durationMs: 120 } }), {
    type: 'tool_result', tool: 'compose.ps', success: true, durationMs: 120, summary: '{}',
  });
  assert.deepEqual(toPublicAgentEvent({ type: 'tool_requested', tool: 'config.inspect' }), { type: 'tool_requested', tool: 'config.inspect' });
  assert.deepEqual(toPublicAgentEvent({ type: 'tool_executing', tool: 'config.inspect' }), { type: 'tool_executing', tool: 'config.inspect' });
  assert.deepEqual(toPublicAgentEvent({ type: 'tool_rejected', tool: 'compose.restart' }), { type: 'tool_rejected', tool: 'compose.restart' });
  assert.deepEqual(toPublicAgentEvent({ type: 'tool_error', tool: 'compose.logs', error: '容器不存在' }), { type: 'tool_error', tool: 'compose.logs', error: '容器不存在' });
});
