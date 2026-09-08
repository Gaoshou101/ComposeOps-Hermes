/**
 * Agent 工具注册总入口。
 *
 * 31 个工具按域拆到 tools/ 下三个纯注册函数(registerComposeTools / registerConfigTools /
 * registerMaintenanceTools),由本文件统一组装。拆分只搬运、不改任何工具体。
 *
 * 只读探测与容器日志读取统一走 ../lib/docker-exec.js(白名单单一事实来源)。
 */

import { registerComposeTools } from './tools/compose-tools.js';
import { registerConfigTools } from './tools/config-tools.js';
import { registerMaintenanceTools } from './tools/maintenance-tools.js';
import { registerContextTools } from './tools/context-tools.js';

/** 工具风险等级:低/中/高/极高,前端据此决定确认强度。单一事实来源。 */
export const RISK_LEVELS = {
  'compose.up': 'high',
  'compose.stop': 'high',
  'compose.restart': 'medium',
  'compose.pull': 'low',
  'config.edit': 'high',
  'config.rollback': 'high',
  'environment.set': 'high',
  'volume.mount': 'high',
  'maintenance.clean': 'critical',
  'compose.exec': 'high',
  'compose.scale': 'medium',
  'cron.create': 'medium',
};

/**
 * 动态风险评估:根据项目上下文提升工具风险等级。
 * @param {string} toolName - 工具名称
 * @param {object} params - 工具参数
 * @param {object} context - 执行上下文(包含 project)
 * @returns {string} 动态评估后的风险等级
 */
export function assessRisk(toolName, params, context) {
  const baseRisk = RISK_LEVELS[toolName] || 'low';

  // 生产项目提升风险等级
  const project = context?.project;
  if (project && (project.tags?.includes('production') || project.projectName?.match(/prod|production/i))) {
    if (baseRisk === 'medium') return 'high';
    if (baseRisk === 'high') return 'critical';
  }

  return baseRisk;
}

/** 注册全部域工具到 agent。 */
export function registerAgentTools(agent) {
  registerComposeTools(agent);
  registerConfigTools(agent);
  registerMaintenanceTools(agent);
  registerContextTools(agent);
  return agent;
}
