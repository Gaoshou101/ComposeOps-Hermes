import {
  createWorkflowDefinition,
  getWorkflowDefinition,
  listWorkflowDefinitions,
  updateWorkflowDefinition,
  deleteWorkflowDefinition,
  createWorkflowInstance,
  getWorkflowInstance,
  listWorkflowInstances,
  updateWorkflowInstance,
  addWorkflowStep,
  updateWorkflowStep,
} from '../lib/db.js';
import { addEventRecord } from '../lib/db.js';
import { emitEvent } from './events.js';

/**
 * 轻量工作流引擎:
 * - 定义(workflow_definitions)由节点编排组成,节点类型:trigger / condition / agent / approval / action / verify;
 * - 实例(workflow_instances)记录一次运行,步骤(workflow_steps)记录每个节点的执行结果;
 * - 支持手动触发与事件触发;approval 节点进入 waiting_approval 等待人工审批。
 *
 * 设计目标:Agent 成为工作流中的一个节点(agent 节点),而非工作流本身,实现 Agent 与编排解耦。
 */

const NODE_TYPES = new Set(['trigger', 'condition', 'agent', 'approval', 'action', 'verify']);

function validateNodes(nodes) {
  if (!Array.isArray(nodes)) throw Object.assign(new Error('节点编排必须是数组'), { statusCode: 400 });
  for (const node of nodes) {
    if (!node || typeof node !== 'object') throw Object.assign(new Error('节点格式无效'), { statusCode: 400 });
    if (!node.id) throw Object.assign(new Error('节点缺少 id'), { statusCode: 400 });
    if (!NODE_TYPES.has(node.type)) throw Object.assign(new Error(`未知节点类型:${node.type}`), { statusCode: 400 });
  }
  return nodes;
}

export function createDefinition({ name, description = '', triggerType = 'manual', triggerConfig = {}, nodes = [], enabled = 1 }) {
  if (!name || !String(name).trim()) throw Object.assign(new Error('工作流名称不能为空'), { statusCode: 400 });
  validateNodes(nodes);
  return createWorkflowDefinition({ name: String(name).trim(), description, triggerType, triggerConfig, nodes, enabled });
}

export function updateDefinition(id, patch = {}) {
  if (patch.nodes !== undefined) validateNodes(patch.nodes);
  return updateWorkflowDefinition(id, patch);
}

export function listDefinitions() {
  return listWorkflowDefinitions();
}

export function getDefinition(id) {
  return getWorkflowDefinition(id);
}

export function removeDefinition(id) {
  return deleteWorkflowDefinition(id);
}

/** 启动一次工作流实例。event 触发时由事件中心调用。 */
export function startWorkflow(definitionId, context = {}) {
  const definition = getWorkflowDefinition(definitionId);
  if (!definition) throw Object.assign(new Error('工作流不存在'), { statusCode: 404 });
  if (!definition.enabled) throw Object.assign(new Error('工作流已停用'), { statusCode: 400 });

  const instance = createWorkflowInstance({
    definitionId,
    name: definition.name,
    status: 'running',
    context,
  });
  const startedAt = new Date().toISOString();
  updateWorkflowInstance(instance.id, { status: 'running', startedAt });

  // 异步执行,不阻塞调用方
  void runWorkflow(instance.id);
  return getWorkflowInstance(instance.id);
}

/** 执行工作流实例的节点编排。 */
async function runWorkflow(instanceId) {
  const instance = getWorkflowInstance(instanceId);
  if (!instance) return;
  const definition = getWorkflowDefinition(instance.definitionId);
  if (!definition) return;

  const nodes = definition.nodes || [];
  let context = { ...(instance.context || {}) };
  const completedNodeIds = new Set(
    (instance.steps || []).filter((step) => step.status === 'success').map((step) => step.nodeId)
  );

  try {
    for (const node of nodes) {
      // 审批通过后恢复执行时,跳过已完成节点。
      if (completedNodeIds.has(node.id)) continue;

      const stepId = addWorkflowStep({
        instanceId,
        nodeId: node.id,
        nodeType: node.type,
        status: 'running',
        input: { ...(node.config || {}), context },
      });
      updateWorkflowInstance(instanceId, { currentNode: node.id });
      const startedAt = new Date().toISOString();
      updateWorkflowStep(stepId, { startedAt });

      // approval 节点:暂停等待人工审批,不继续执行后续节点。
      if (node.type === 'approval') {
        updateWorkflowStep(stepId, { status: 'waiting_approval' });
        updateWorkflowInstance(instanceId, { status: 'waiting_approval' });
        emitEvent({ type: 'workflow', eventType: 'workflow', title: `工作流等待审批:${definition.name}`, detail: node.id, severity: 'warning' });
        return;
      }

      const result = await executeNode(node, context);
      context = { ...context, ...(result.context || {}) };
      updateWorkflowStep(stepId, { status: 'success', output: result.output || {}, finishedAt: new Date().toISOString() });
      emitEvent({ type: 'workflow', eventType: 'workflow', title: `工作流节点完成:${node.id}`, detail: node.type, severity: 'info' });
    }
    updateWorkflowInstance(instanceId, { status: 'success', result: { summary: '工作流执行完成' }, finishedAt: new Date().toISOString() });
    addEventRecord({
      eventType: 'workflow',
      source: 'workflow',
      title: `工作流完成:${definition.name}`,
      detail: `实例 ${instanceId} 执行成功`,
      severity: 'info',
      status: 'resolved',
      payload: { instanceId, definitionId: definition.id },
    });
  } catch (error) {
    updateWorkflowInstance(instanceId, { status: 'failed', result: { error: error.message }, finishedAt: new Date().toISOString() });
    addEventRecord({
      eventType: 'workflow',
      source: 'workflow',
      title: `工作流失败:${definition.name}`,
      detail: error.message,
      severity: 'danger',
      status: 'open',
      payload: { instanceId, definitionId: definition.id },
    });
    emitEvent({ type: 'workflow', eventType: 'workflow', title: `工作流失败:${definition.name}`, detail: error.message, severity: 'danger' });
  }
}

/** 执行单个节点。 */
async function executeNode(node, context) {
  switch (node.type) {
    case 'trigger':
      return { output: { triggered: true } };
    case 'condition': {
      const expr = node.config?.expression || '';
      const matched = evaluateCondition(expr, context);
      return { output: { matched }, context: { conditionMatched: matched } };
    }
    case 'agent': {
      // Agent 节点:调用 Agent 执行(只读分析或生成方案)。此处为占位,实际接入 agent engine。
      const prompt = node.config?.prompt || '';
      return { output: { agentResult: `Agent 分析完成:${prompt || '无提示词'}` } };
    }
    case 'action': {
      const action = node.config?.action || '';
      return { output: { action, executed: true } };
    }
    case 'verify': {
      return { output: { verified: true } };
    }
    default:
      return { output: {} };
  }
}

/** 简单条件求值:支持 `context.field == value` / `!=` / `>` / `<`。 */
function evaluateCondition(expr, context) {
  const match = /^([\w.]+)\s*(==|!=|>|<|>=|<=)\s*(.+)$/.exec(String(expr || '').trim());
  if (!match) return false;
  const [, field, op, rawValue] = match;
  const actual = field.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), context);
  const expected = rawValue.trim().replace(/^['"]|['"]$/g, '');
  switch (op) {
    case '==': return String(actual) === expected;
    case '!=': return String(actual) !== expected;
    case '>': return Number(actual) > Number(expected);
    case '<': return Number(actual) < Number(expected);
    case '>=': return Number(actual) >= Number(expected);
    case '<=': return Number(actual) <= Number(expected);
    default: return false;
  }
}

export function listInstances({ status = '', limit = 50 } = {}) {
  return listWorkflowInstances({ status, limit });
}

export function getInstance(id) {
  return getWorkflowInstance(id);
}

/** 人工审批:推进等待审批的实例。 */
export function approveInstance(instanceId, { approved = true, note = '' } = {}) {
  const instance = getWorkflowInstance(instanceId);
  if (!instance) throw Object.assign(new Error('工作流实例不存在'), { statusCode: 404 });
  if (instance.status !== 'waiting_approval') throw Object.assign(new Error('该实例不在等待审批状态'), { statusCode: 400 });

  if (!approved) {
    updateWorkflowInstance(instanceId, { status: 'cancelled', finishedAt: new Date().toISOString() });
    return getWorkflowInstance(instanceId);
  }

  // 找到等待审批的步骤,标记为通过,然后继续执行后续节点。
  const pendingStep = instance.steps.find((step) => step.status === 'waiting_approval');
  if (pendingStep) {
    updateWorkflowStep(pendingStep.id, { status: 'success', output: { approved: true, note }, finishedAt: new Date().toISOString() });
  }
  updateWorkflowInstance(instanceId, { status: 'running' });
  void runWorkflow(instanceId);
  return getWorkflowInstance(instanceId);
}

export function cancelInstance(instanceId) {
  const instance = getWorkflowInstance(instanceId);
  if (!instance) throw Object.assign(new Error('工作流实例不存在'), { statusCode: 404 });
  updateWorkflowInstance(instanceId, { status: 'cancelled', finishedAt: new Date().toISOString() });
  return getWorkflowInstance(instanceId);
}