import js from '@eslint/js';
import globals from 'globals';

/**
 * 后端 lint 规则:只保留能稳定发现真实缺陷的规则,避免风格噪音淹没告警。
 *
 * 两条 backlog 里点名的规则无法照原样启用,这里记录取舍:
 *  - no-floating-promises 需要类型信息(typescript-eslint),纯 JS 项目没有等价核心规则,
 *    改用 no-async-promise-executor + require-atomic-updates 覆盖部分异步误用。
 *  - require-await 与 Fastify 约定冲突:插件入口、路由处理器、onSend 钩子按约定必须是
 *    async,直接返回 Promise 的服务函数同样不需要 await。全量扫描 71 处命中零缺陷,
 *    故不启用,避免真实告警被淹没。
 */
export default [
  {
    ignores: ['node_modules/**', 'data/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // 未使用变量往往是重构残留;下划线前缀视为显式忽略。
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      // 异步误用与竞态。
      'no-async-promise-executor': 'error',
      'require-atomic-updates': 'error',
      // 容易静默失败的写法。
      'no-return-await': 'error',
      'no-useless-assignment': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      // 空 catch 多为有意的 best-effort 兜底(见 Fix #10),降级为警告便于逐步收敛。
      'no-empty': 'warn',
    },
  },
];
