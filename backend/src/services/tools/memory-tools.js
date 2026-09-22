/** 长期记忆工具:只保存用户明确表达的稳定偏好和环境事实。 */
import { deleteAiMemory, listAiMemories, recordAiMemoryRecall, sleepAiMemories, upsertAiMemory } from '../../lib/db.js';

export function registerMemoryTools(agent) {
  agent
    .registerTool('memory.search', {
      description: '按重要度/新鲜度/可信度加权排序,检索与当前问题相关的用户长期偏好和运维环境记忆;返回即计为一次召回',
      category: 'memory',
      requiredPermission: 'readonly',
      confirmationRequired: false,
      requiresProject: false,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1, maxLength: 200 },
          limit: { type: 'number', description: '返回条数(默认 8,最大 50)' },
        },
        required: ['query'],
      },
      execute: async (params) => {
        const limit = Math.min(Math.max(Number(params.limit) || 8, 1), 50);
        const memories = listAiMemories(limit, params.query);
        if (memories.length) recordAiMemoryRecall(memories.map((item) => item.id));
        return { memories };
      },
    })
    .registerTool('memory.save', {
      description: '保存用户明确确认的长期偏好或稳定运维事实,不要保存密码和令牌;veracity 如实声明:stated 用户明确陈述/inferred 自行推断/tool 工具直接观测/unknown 存疑',
      category: 'memory',
      requiredPermission: 'readonly',
      confirmationRequired: false,
      requiresProject: false,
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', minLength: 1, maxLength: 160 },
          value: { type: 'string', minLength: 1, maxLength: 4000 },
          source: { type: 'string', maxLength: 64 },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
          importance: { type: 'number', minimum: 0, maximum: 1, description: '重要度 0-1(默认 0.5;用户核心偏好建议 ≥0.8)' },
          veracity: { type: 'string', enum: ['stated', 'inferred', 'tool', 'unknown'], description: '可信度来源' },
        },
        required: ['key', 'value'],
      },
      execute: async (params) => {
        if (/(SECRET|TOKEN|PASSWORD|PASSWD|API[_-]?KEY|PRIVATE[_-]?KEY|AUTH[_-]?KEY)/i.test(`${params.key} ${params.value}`)) {
          throw Object.assign(new Error('长期记忆不能保存密码、令牌或密钥'), { statusCode: 400 });
        }
        return {
          saved: true,
          memory: upsertAiMemory(params.key, params.value, params.source, params.confidence, {
            importance: params.importance,
            veracity: params.veracity,
          }),
        };
      },
    })
    .registerTool('memory.delete', {
      description: '删除一条长期记忆',
      category: 'memory',
      requiredPermission: 'readonly',
      confirmationRequired: true,
      requiresProject: false,
      parameters: {
        type: 'object',
        properties: { key: { type: 'string', minLength: 1, maxLength: 160 } },
        required: ['key'],
      },
      execute: async (params) => ({ deleted: deleteAiMemory(params.key), key: params.key }),
    })
    .registerTool('memory.sleep', {
      description: '记忆维护(确定性,无 LLM):合并重复内容、衰减 30 天未用记忆的重要度、清理 90 天以上从未召回的低价值记忆',
      category: 'memory',
      requiredPermission: 'readonly',
      confirmationRequired: true,
      requiresProject: false,
      parameters: { type: 'object', properties: {} },
      execute: async () => sleepAiMemories(),
    });
  return agent;
}
