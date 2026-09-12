/**
 * AI Agent 路由(/agent/*)。
 *
 * 执行路径已收敛为 Tool Loop 单一通道:
 *  - POST /agent/execute-stream —— 流式执行(SSE),高危工具经 confirmation_required → /agent/approve
 *  - GET  /agent/executions —— 执行审计
 *  - 会话与长期记忆复用 AI 会话存储
 * 早期"先规划后执行"(plan/execute/confirm/feedback/export 等)端点已随
 * executeWorkflow 规划管线一并移除;schema 约定沿用 ai.js 文件头。
 */
import {
  getAgentPlan,
  listAgentExecutions,
  listAgentPlans,
  createAiSession,
  renameAiSession,
  listAiMemories,
} from '../lib/db.js';
import { getAgent } from '../services/agent.js';
import { idField, limitField, numericId } from '../lib/schemas.js';
import { redactRows, redactValue } from '../lib/redaction.js';
import { toPublicAgentEvent } from '../lib/agent-public-events.js';

export default async function agentRoutes(fastify) {
  // POST /api/v1/ai/agent/sessions —— 创建聊天会话
  fastify.post('/agent/sessions', async () => ({ sessionId: createAiSession() }));

  // PATCH /api/v1/ai/agent/sessions/:sessionId —— 重命名聊天会话
  fastify.patch('/agent/sessions/:sessionId', {
    schema: {
      params: { type: 'object', required: ['sessionId'], properties: { sessionId: numericId } },
      body: {
        type: 'object', additionalProperties: false, required: ['title'],
        properties: { title: { type: 'string', minLength: 1, maxLength: 80 } },
      },
    },
  }, async (request, reply) => {
    try {
      renameAiSession(request.params.sessionId, request.body.title);
      return { ok: true, title: request.body.title.trim().slice(0, 80) };
    } catch (error) {
      return reply.code(error.statusCode || 400).send({ error: 'session_rename_failed', message: error.message });
    }
  });

  // GET /api/v1/ai/agent/memories —— 长期记忆管理页/侧栏
  fastify.get('/agent/memories', {
    schema: { querystring: { type: 'object', properties: { limit: limitField(200), query: { type: 'string', maxLength: 200 } } } },
  }, async (request) => ({ memories: listAiMemories(request.query?.limit, request.query?.query) }));

  // GET /api/v1/ai/agent/executions —— 执行历史(审计)
  // 同一个 limit 同时喂 listAgentPlans(上限 100)与 listAgentExecutions(上限 500),
  // 故按更宽的 500 收 —— 取 100 会把执行历史的可取范围凭空砍掉八成。
  fastify.get('/agent/executions', {
    schema: {
      querystring: {
        type: 'object',
        properties: { planId: numericId, limit: limitField(500) },
      },
    },
  }, async (request) => {
    const planId = request.query?.planId;
    if (planId) {
      return { plan: redactValue(getAgentPlan(planId)), executions: redactRows(listAgentExecutions(planId, request.query?.limit)) };
    }
    return { plans: redactRows(listAgentPlans(request.query?.limit)), executions: redactRows(listAgentExecutions(null, request.query?.limit)) };
  });

  // POST /api/v1/ai/agent/execute-stream —— Tool-calling 原生循环 + SSE 流式推送
  fastify.post('/agent/execute-stream', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['message'],
        properties: {
          message: { type: 'string', maxLength: 32768 },
          projectId: idField,
          containerId: idField,
          sessionId: numericId,
          role: { type: 'string', maxLength: 32 },
          webSearchEnabled: { type: 'boolean' },
          attachedLogs: { type: 'string', maxLength: 50000 },
          history: {
            type: 'array',
            maxItems: 12,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['role', 'content'],
              properties: {
                role: { type: 'string', enum: ['user', 'assistant'] },
                content: { type: 'string', maxLength: 12000 },
              },
            },
          },
          pageContext: {
            type: 'object',
            additionalProperties: false,
            properties: {
              page: { type: 'string', maxLength: 120 },
              route: { type: 'string', maxLength: 512 },
              mode: { type: 'string', maxLength: 120 },
              summary: { type: 'string', maxLength: 1000 },
              state: { type: 'string', maxLength: 12000 },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { message, projectId, containerId, sessionId, role, webSearchEnabled = false, attachedLogs = '', history = [], pageContext = {} } = request.body || {};
    if (!message || !String(message).trim()) {
      return reply.code(400).send({ error: 'missing_message', message: '缺少 message' });
    }

    // 设置 SSE 响应头
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (event) => {
      if (reply.raw.destroyed || reply.raw.writableEnded) return;
      const publicEvent = toPublicAgentEvent(event);
      if (publicEvent) reply.raw.write(`data: ${JSON.stringify(publicEvent)}\n\n`);
    };

    const agent = getAgent();
    const context = { projectId, containerId, sessionId, role, webSearchEnabled, attachedLogs, history, pageContext };

    // 客户端断开时中断执行
    const abortController = new AbortController();
    let completed = false;
    reply.raw.on('close', () => {
      if (!completed) {
        console.log('[agent:execute-stream] Client disconnected, aborting execution');
        abortController.abort();
      }
    });

    try {
      // 调用 executeWithLoop,事件通过 onEvent 回调推送
      await agent.executeWithLoop(message, context, send, abortController.signal);
    } catch (error) {
      if (error.name === 'AbortError') {
        send({ type: 'interrupted', content: '执行已被用户中断' });
      } else {
        send({ type: 'error', content: error.message });
      }
    } finally {
      // 无论正常结束、确认等待超时还是客户端断开,都补发 done,
      // 保证前端 running 状态一定在 SSE 关闭前清理。
      send({ type: 'done', content: null, closed: true });
      completed = true;
      reply.raw.end();
    }
  });

  // POST /api/v1/ai/agent/approve —— 批准工具调用(支持确认弹窗编辑参数)
  fastify.post('/agent/approve', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['executionId', 'toolCallId', 'approved'],
        properties: {
          executionId: { type: 'string', maxLength: 128 },
          toolCallId: { type: 'string', maxLength: 128 },
          approved: { type: 'boolean' },
          input: { type: 'object' },
        },
      },
    },
  }, async (request, reply) => {
    const { executionId, toolCallId, approved, input } = request.body || {};
    const agent = getAgent();
    const success = agent.approveToolCall(executionId, toolCallId, approved, input);
    if (!success) {
      return reply.code(404).send({ error: 'execution_not_found', message: '执行会话不存在或已完成' });
    }
    return { success: true };
  });
}
