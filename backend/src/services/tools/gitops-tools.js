/**
 * GitOps drift 域工具注册(gitops.drift)。
 * 只读:扫描每个 GitOps 仓库的生产状态与 Git 远端的漂移
 * (未提交改动 / 落后远端 / detached HEAD),并给出修复建议。
 * 修复(changes/rollback/sync)走现有确认门,这里不执行任何变更。
 */
import { planAllRepoDrift } from '../gitops-drift.js';

export function registerGitopsTools(agent) {
  agent
    .registerTool('gitops.drift', {
      description: '只读扫描全部 GitOps 仓库:生产 Compose/.env 与 Git 远端的漂移(未提交改动、落后远端、detached HEAD),返回逐仓库结论与修复建议;不执行任何变更',
      category: 'diagnostic',
      requiredPermission: 'readonly',
      confirmationRequired: false,
      requiresProject: false,
      parameters: { type: 'object', properties: {}, additionalProperties: true },
      execute: async () => {
        const results = await planAllRepoDrift();
        return {
          scope: 'gitops',
          summary: results.map((item) => `${item.repoName}:${item.summary}`).join('\n'),
          repos: results.map((item) => ({
            repoId: item.repoId,
            repoName: item.repoName,
            status: item.status,
            behind: item.behind,
            detached: item.detached,
            branch: item.branch || '',
            drifts: item.drifts,
            summary: item.summary,
            repairs: item.repairs,
          })),
          note: '以上为只读漂移扫描;需要执行同步/回滚/提交时请给出具体动作,系统会在确认后执行。',
        };
      },
    });
}