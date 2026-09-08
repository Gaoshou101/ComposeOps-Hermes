/** 长期记忆工具:只保存用户明确表达的稳定偏好和环境事实。 */
import { deleteAiMemory, listAiMemories, upsertAiMemory } from '../../lib/db.js';

export function registerMemoryTools(agent) {
  agent
    .registerTool('memory.search', {
      description: '搜索与当前问题相关的用户长期偏好和运维环境记忆',
      category: 'memory',
      requiredPermission: 'readonly',
      confirmationRequired: false,
      requiresProject: false,
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', minLength: 1, maxLength: 200 } },
        required: ['query'],
      },
      execute: async (params) => ({ memories: listAiMemories(20, params.query) }),
    })
    .registerTool('memory.save', {
      description: '保存用户明确确认的长期偏好或稳定运维事实,不要保存密码和令牌',
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
        },
        required: ['key', 'value'],
      },
      execute: async (params) => {
        if (/(SECRET|TOKEN|PASSWORD|PASSWD|API[_-]?KEY|PRIVATE[_-]?KEY|AUTH[_-]?KEY)/i.test(`${params.key} ${params.value}`)) {
          throw Object.assign(new Error('长期记忆不能保存密码、令牌或密钥'), { statusCode: 400 });
        }
        return { saved: true, memory: upsertAiMemory(params.key, params.value, params.source, params.confidence) };
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
    });
  return agent;
}
