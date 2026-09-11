import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({
  createAgentSession: vi.fn(),
  agentExecuteStream: vi.fn(),
  agentApprove: vi.fn(),
}));
vi.mock('../src/api/client.js', () => ({ api: apiMock }));

const { useAgentChat } = await import('../src/composables/useAgentChat.js');

describe('useAgentChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.createAgentSession.mockResolvedValue({ sessionId: 7 });
  });

  it('发送时惰性建会话,不回传 history,token 分片原样拼接', async () => {
    const chat = useAgentChat();
    apiMock.agentExecuteStream.mockImplementation(async (payload, onEvent) => {
      expect(payload.sessionId).toBe(7);
      expect(payload.history).toBeUndefined();
      onEvent({ type: 'token', content: '结论 ' });
      onEvent({ type: 'token', content: '\n\n| a | b |' });
    });
    await chat.sendMessage('检查项目', { pageContext: { page: '服务' } });
    expect(apiMock.createAgentSession).toHaveBeenCalledTimes(1);
    expect(chat.messages.value).toHaveLength(2);
    expect(chat.messages.value[1].content).toBe('结论 \n\n| a | b |');
    expect(chat.running.value).toBe(false);
    expect(chat.messages.value[1].streaming).toBe(false);
  });

  it('done 事件用后端最终全文覆盖,自愈流式期间任何错位', async () => {
    const chat = useAgentChat();
    apiMock.agentExecuteStream.mockImplementation(async (payload, onEvent) => {
      onEvent({ type: 'token', content: '流式中间态 tool_' });
      onEvent({ type: 'done', content: '最终干净文本' });
    });
    await chat.sendMessage('hi');
    expect(chat.messages.value[1].content).toBe('最终干净文本');
  });

  it('error/interrupted 追加并清理确认卡,confirmation 卡走 approve', async () => {
    const chat = useAgentChat();
    apiMock.agentExecuteStream.mockImplementation(async (payload, onEvent) => {
      onEvent({ type: 'confirmation_required', executionId: 'plan-1', toolCallId: 'call-1', description: '重启' });
      onEvent({ type: 'error', content: '执行失败' });
    });
    await chat.sendMessage('hi');
    const assistant = chat.messages.value[1];
    expect(assistant.confirmation).toBeNull();
    expect(assistant.content).toContain('执行失败');

    apiMock.agentApprove.mockResolvedValue({ success: true });
    const message = { confirmation: { executionId: 'p', toolCallId: 'c', busy: false } };
    await chat.approve(message);
    expect(apiMock.agentApprove).toHaveBeenCalledWith({ executionId: 'p', toolCallId: 'c', approved: true });
    expect(message.confirmation).toBeNull();
  });
});
