import test from 'node:test';
import assert from 'node:assert/strict';
import { toPublicAgentEvent } from '../src/lib/agent-public-events.js';

test('公开 Agent 事件隐藏工具协议和内部工具字段', () => {
  assert.equal(toPublicAgentEvent({ type: 'trace', trace: { content: 'tool_call secret' } }), null);
  assert.deepEqual(toPublicAgentEvent({ type: 'token', content: '回答 tool_ca' }), { type: 'token', content: '回答' });
  assert.deepEqual(toPublicAgentEvent({ type: 'token', content: 'iNdEx++ result= composeOps.project.list_managed()project_list<tID | 项目名称 |\n您当前可以操作的项目如下:' }), { type: 'token', content: '您当前可以操作的项目如下:' });
  assert.deepEqual(toPublicAgentEvent({ type: 'token', content: 'for (let index = 0; index < 3; index++) {}' }), { type: 'token', content: 'for (let index = 0; index < 3; index++) {}' });
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
  assert.equal(toPublicAgentEvent({ type: 'tool_result', tool: 'compose.ps', result: { result: {} } }), null);
});
