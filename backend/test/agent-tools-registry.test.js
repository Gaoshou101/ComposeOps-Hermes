import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENT_TOOLS = path.join(__dirname, '../src/services/agent-tools.js');

// 工具名来自 agent-tool-categories / 编排定义:agent.js 里 macro/角色/验证器按名引用,
// 若注册少了某工具,运行期会静默变“未注册”。此清单把这些**必须存在**的名字固化。
const REQUIRED_TOOLS = [
  // 角色白名单直接依赖(validator/incident_responder allowedTools)
  'compose.ps', 'compose.logs', 'metrics.query', 'network.inspect',
  'config.validate', 'config.preview',
  'compose.restart', 'compose.up', 'compose.stop',
  'alert.create', 'diagnostic.probe', 'diagnostic.analyze',
  // 确定性回退规划(defaultPlan)依赖
  'compose.pull', 'config.edit', 'maintenance.clean', 'maintenance.update',
  // 其它全部已注册工具(防删漏)
  'compose.exec', 'compose.scale', 'config.rollback', 'config.diff',
  'environment.get', 'environment.set', 'volume.mount',
  'security.audit', 'backup.trigger', 'notification.test', 'cron.create',
  'performance.baseline', 'alert.configure', 'alert.list', 'alert.delete',
];

test('agent-tools.js 注册表包含全部必需工具', () => {
  const source = readFileSync(AGENT_TOOLS, 'utf8');
  for (const name of REQUIRED_TOOLS) {
    assert.ok(source.includes(`registerTool('${name}'`), `缺少工具注册:${name}`);
  }
});

test('agent-tools.js 保留只读白名单锚定(不含 curl/wget)', () => {
  const source = readFileSync(AGENT_TOOLS, 'utf8');
  // 注册表本身不做 exec,只读执行应统一走 docker-exec —— 不允许出现第二份白名单/exec 实现
  assert.ok(!source.includes('READONLY_EXEC'));
  assert.ok(!source.includes('curl http'));
  assert.ok(!source.includes('AttachStdout: true, AttachStderr: true, Cmd: parts'));
});
