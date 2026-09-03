import { listAgentPlans } from '../lib/db.js';

/**
 * 基于历史执行记录生成智能建议
 * 算法:
 * 1. 统计近期成功的 user_message 模式,按频次排序
 * 2. 优先推荐高评分(rating >= 4)的操作
 * 3. 按项目过滤(如果指定 projectId)
 * 4. 去重并按 frequency * rating 权重排序
 */
export function generateSmartSuggestions(projectId, limit = 5) {
  const allPlans = listAgentPlans(500);
  
  // 过滤:仅保留已完成的计划
  const completed = allPlans.filter((p) => p.status === 'completed');
  if (!completed.length) return [];

  // 统计 user_message 频次与评分
  const messageStats = new Map();
  for (const plan of completed) {
    const msg = String(plan.user_message || '').trim();
    if (!msg || msg.length > 100) continue; // 跳过空消息与超长文本
    
    // 项目过滤:从 plan_json 或 result_json 中提取 projectId(如果存在)
    if (projectId) {
      try {
        const planData = JSON.parse(plan.plan_json || '{}');
        const resultData = JSON.parse(plan.result_json || '{}');
        const planProjectId = planData.projectId || resultData.projectId;
        if (planProjectId && planProjectId !== projectId) continue;
      } catch {
        // 解析失败时不过滤,保留通用建议
      }
    }

    const existing = messageStats.get(msg) || { message: msg, frequency: 0, totalRating: 0, count: 0, lastUsed: plan.executed_at || plan.created_at };
    existing.frequency += 1;
    existing.totalRating += plan.rating || 3; // 默认评分 3
    existing.count += 1;
    // 更新最近使用时间
    const timestamp = plan.executed_at || plan.created_at;
    if (timestamp > existing.lastUsed) existing.lastUsed = timestamp;
    messageStats.set(msg, existing);
  }

  // 转换为数组并计算权重
  const suggestions = Array.from(messageStats.values()).map((stat) => ({
    label: stat.message,
    message: stat.message,
    frequency: stat.frequency,
    avgRating: stat.totalRating / stat.count,
    lastUsed: stat.lastUsed,
    weight: stat.frequency * (stat.totalRating / stat.count),
  }));

  // 排序:权重优先,频次次之,最近使用时间再次之
  suggestions.sort((a, b) => {
    if (Math.abs(a.weight - b.weight) > 0.1) return b.weight - a.weight;
    if (a.frequency !== b.frequency) return b.frequency - a.frequency;
    return new Date(b.lastUsed) - new Date(a.lastUsed);
  });

  return suggestions.slice(0, Math.max(1, Math.min(Number(limit) || 5, 10)));
}
