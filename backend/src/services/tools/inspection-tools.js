/**
 * 巡检域工具注册(inspection.run / inspection.status)。
 * 让 Agent 可以在对话里直接发起一次全系统只读巡检 —— 结果落库(inspections),
 * 返回压缩版报告给 LLM,避免把完整 findings 灌进上下文。
 */
import { runInspection, getInspectionOverview, GRADE_LABELS } from '../inspection.js';

export function registerInspectionTools(agent) {
  agent
    .registerTool('inspection.run', {
      description: '执行一次全系统只读巡检(容器状态/磁盘/内存/备份时效/项目纳管),返回评分、结论与建议动作;不执行任何变更',
      category: 'diagnostic',
      requiredPermission: 'readonly',
      confirmationRequired: false,
      requiresProject: false,
      parameters: { type: 'object', properties: {}, additionalProperties: true },
      execute: async () => {
        const report = await runInspection({ source: 'agent' });
        const findingsByLevel = (level) => report.findings.filter((item) => item.level === level);
        return {
          scope: 'host',
          score: report.score,
          grade: report.grade,
          gradeLabel: GRADE_LABELS[report.grade] || report.grade,
          summary: report.summary,
          criticals: findingsByLevel('critical').map((item) => ({ title: item.title, detail: item.detail, advice: item.advice, tool: item.tool })),
          warnings: findingsByLevel('warning').map((item) => ({ title: item.title, detail: item.detail, advice: item.advice, tool: item.tool })),
          infos: findingsByLevel('info').map((item) => ({ title: item.title, detail: item.detail })),
          predictions: report.predictions,
          stats: report.stats,
          note: '以上为只读巡检结论;带 tool 的建议可以通过对应工具或交给用户确认后执行。',
        };
      },
    })
    .registerTool('inspection.status', {
      description: '查看巡检配置(自动巡检开关/间隔/上次执行时间)与最近一次巡检摘要(只读)',
      category: 'diagnostic',
      requiredPermission: 'readonly',
      confirmationRequired: false,
      requiresProject: false,
      parameters: { type: 'object', properties: {}, additionalProperties: true },
      execute: async () => {
        const overview = getInspectionOverview(3);
        const latest = overview.latest;
        return {
          schedule: overview.schedule,
          latest: latest
            ? { score: latest.score, grade: latest.grade, gradeLabel: GRADE_LABELS[latest.grade] || latest.grade, summary: latest.summary, createdAt: latest.createdAt }
            : null,
          note: '开启自动巡检后,系统会按间隔周期执行并在巡检页展示;最近一次完整报告可在巡检页查看。',
        };
      },
    });
}