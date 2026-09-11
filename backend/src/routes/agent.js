/**
 * AI Agent 编排路由(/agent/*)。
 * 从 routes/ai.js 拆分而来 —— 处理函数与 schema 逐字节搬运,不改变语义。
 *
 * schema 约定沿用 ai.js 文件头:长度上限取服务端 slice 值的数倍、role 不设 enum、
 * planId/sessionId 收 anyOf(整数|字符串)、steps[].params 保持开放(见 lib/schemas.js)。
 */
import {
  getAgentPlan,
  listAgentExecutions,
  listAgentPlans,
  listAgentFeedback,
  listPerformanceBaselines,
  recordAgentFeedback,
  updateAgentPlan,
  createAiSession,
  renameAiSession,
  listAiMemories,
} from '../lib/db.js';
import { getAgent } from '../services/agent.js';
import { generateSmartSuggestions } from '../services/agent-suggestions.js';
import { agentStep, idField, limitField, numericId } from '../lib/schemas.js';
import { redactRows, redactValue } from '../lib/redaction.js';

export default async function agentRoutes(fastify) {
  // ===== Agent 编排端点 =====

  // GET /api/v1/ai/agent/tools —— 可用工具元数据
  fastify.get('/agent/tools', async () => ({ tools: getAgent().listTools() }));

  // GET /api/v1/ai/agent/categories —— 工具分类元数据
  fastify.get('/agent/categories', async () => {
    const { TOOL_CATEGORIES, getToolsByCategory } = await import('../services/agent-tool-categories.js');
    const categories = Object.entries(TOOL_CATEGORIES).map(([key, meta]) => ({
      key,
      ...meta,
      tools: getToolsByCategory(key),
    }));
    return { categories };
  });

  // GET /api/v1/ai/agent/roles —— 多角色 Agent 元数据
  fastify.get('/agent/roles', async () => ({ roles: getAgent().listRoles() }));

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

  // POST /api/v1/ai/agent/plan —— 规划(不执行),返回思维链与执行计划
  // role 不设 enum:agent.js 把未知 role 归一为 planner,拒绝会改变既有语义。
  fastify.post('/agent/plan', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          message: { type: 'string', maxLength: 32768 },
          projectId: idField,
          containerId: idField,
          sessionId: numericId,
          role: { type: 'string', maxLength: 32 },
        },
      },
    },
  }, async (request, reply) => {
    const { message, projectId, containerId, sessionId, role } = request.body || {};
    if (!message || !String(message).trim()) {
      return reply.code(400).send({ error: 'missing_message', message: '缺少 message' });
    }
    const agent = getAgent();
    const plan = await agent.plan(message, { projectId, containerId, sessionId, role });
    const planId = agent.persistPlan(sessionId, message, plan, { projectId, containerId });
    return { planId, plan: redactValue(plan), thoughts: redactRows(plan.thoughts || []) };
  });

  // POST /api/v1/ai/agent/execute —— 执行已规划或自定义步骤
  // steps 不设 minItems:处理函数自己 Array.isArray && length 校验并返回 missing_steps。
  fastify.post('/agent/execute', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          planId: numericId,
          steps: { type: 'array', maxItems: 100, items: agentStep },
          sessionId: numericId,
        },
      },
    },
  }, async (request, reply) => {
    const { planId, steps } = request.body || {};
    const agent = getAgent();
    if (!planId) {
      return reply.code(400).send({ error: 'missing_plan_id', message: '缺少 planId' });
    }
    const plan = getAgentPlan(planId);
    if (!plan) {
      return reply.code(404).send({ error: 'plan_not_found', message: '执行计划不存在' });
    }
    if (plan.status === 'executing') {
      return reply.code(409).send({ error: 'plan_in_progress', message: '该计划正在执行' });
    }
    const prepared = agent.prepareExecutionSteps(plan, steps);
    updateAgentPlan(planId, { planJson: prepared.planJson });
    const result = await agent.executeWorkflow(planId, prepared.steps, {
      sessionId: plan.session_id,
      projectId: plan.project_id, 
      containerId: plan.container_id,
      role: prepared.planJson.role || 'planner',
    });

    // Phase 1 增强:返回细粒度执行状态
    const updatedPlan = getAgentPlan(planId);
    return {
      ...redactValue(result),
      thoughts: result.thoughts || [],
      progress: {
        stage: updatedPlan.progress_stage || null,
        percent: updatedPlan.progress_percent || 0,
        currentStepIndex: updatedPlan.current_step_index || 0,
        updatedAt: updatedPlan.updated_at || null,
      },
    };
  });

  // POST /api/v1/ai/agent/confirm —— 单工具确认后直接执行(快速操作)
  // params 保持开放:键由工具自己的 parameters 定义,executeTool 内部 validateParams 校验。
  // tool 不设 required:未注册的工具由 executeTool 抛 404,先于它拦下会降级成 validation_failed。
  fastify.post('/agent/confirm', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tool: { type: 'string', maxLength: 64 },
          params: { type: 'object' },
          confirmed: { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    const { tool, params, confirmed } = request.body || {};
    if (!confirmed) {
      return reply.code(400).send({ error: 'not_confirmed', message: '用户未确认该操作' });
    }
    const agent = getAgent();
    const result = await agent.executeTool(tool, params || {}, {});
    return { ...result, thoughts: result.thoughts || [] };
  });

  // GET /api/v1/ai/agent/executions —— 执行历史
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

  // GET /api/v1/ai/agent/feedback —— 用户反馈列表(反馈循环)
  fastify.get('/agent/feedback', {
    schema: { querystring: { type: 'object', properties: { limit: limitField(200) } } },
  }, async (request) => ({ feedback: listAgentFeedback(request.query?.limit) }));

  // POST /api/v1/ai/agent/feedback —— 记录计划评分/反馈
  // rating 越界与 feedbackText 超长都由 db.js 的 recordAgentFeedback 兜住
  // (clamp 1..5、slice 2000),schema 只挡非数值与畸形巨包。
  fastify.post('/agent/feedback', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          planId: numericId,
          rating: { type: 'number' },
          feedbackText: { type: 'string', maxLength: 8000 },
        },
      },
    },
  }, async (request, reply) => {
    const { planId, rating, feedbackText } = request.body || {};
    if (!planId) return reply.code(400).send({ error: 'missing_plan_id', message: '缺少 planId' });
    const updated = recordAgentFeedback(planId, rating, feedbackText);
    if (!updated) return reply.code(404).send({ error: 'plan_not_found', message: '执行计划不存在' });
    return updated;
  });

  // GET /api/v1/ai/agent/suggestions —— 基于历史的智能建议
  fastify.get('/agent/suggestions', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          projectId: idField,
          limit: limitField(10),
        },
      },
    },
  }, async (request) => {
    const { projectId, limit = 5 } = request.query || {};
    const suggestions = await generateSmartSuggestions(projectId, limit);
    return { suggestions };
  });

  // GET /api/v1/ai/agent/export —— 审计/可观测性数据导出
  // 一个 limit 喂四个不同上限(plans 100 / executions 500 / feedback 200 / baselines 100),
  // 只能按最宽的 500 收;各自的上限由 db.js 各自 clamp。
  fastify.get('/agent/export', {
    schema: { querystring: { type: 'object', properties: { limit: limitField(500) } } },
  }, async (request) => ({
    exportedAt: new Date().toISOString(),
    plans: redactRows(listAgentPlans(request.query?.limit || 100)),
    executions: redactRows(listAgentExecutions(null, request.query?.limit || 500)),
    feedback: listAgentFeedback(request.query?.limit || 200),
    baselines: listPerformanceBaselines(request.query?.limit || 100),
  }));

  // POST /api/v1/ai/agent/execute-stream —— Phase 2: Tool-calling 原生循环 + SSE 流式推送
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
    const { message, projectId, containerId, sessionId, role, webSearchEnabled = false, history = [], pageContext = {} } = request.body || {};
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
      reply.raw.write(`data: ${JSON.stringify(redactValue(event))}\n\n`);
    };

    const agent = getAgent();
    const context = { projectId, containerId, sessionId, role, webSearchEnabled, history, pageContext };

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

  // POST /api/v1/ai/agent/approve —— Phase 2: 批准工具调用
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

  // POST /api/v1/ai/agent/interrupt —— Phase 2: 中断执行
  fastify.post('/agent/interrupt', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['executionId'],
        properties: {
          executionId: { type: 'string', maxLength: 128 },
        },
      },
    },
  }, async (request, reply) => {
    const { executionId } = request.body || {};
    const agent = getAgent();
    const success = agent.interruptExecution(executionId);
    if (!success) {
      return reply.code(404).send({ error: 'execution_not_found', message: '执行会话不存在或已完成' });
    }
    return { success: true };
  });
}
