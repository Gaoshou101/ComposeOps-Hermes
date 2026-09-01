import assert from 'node:assert/strict';
import test from 'node:test';
import { validateComposeSemantics, previewComposeChange } from '../src/services/compose-validator.js';

test('compose-validator: 捕获 depends_on 引用不存在服务', () => {
  const issues = validateComposeSemantics(`
services:
  web:
    image: nginx
    depends_on:
      - cache
  db:
    image: postgres
`);
  assert.ok(issues.some((issue) => issue.level === 'error' && /depends_on/.test(issue.message)));
});

test('compose-validator: 健康 compose 无错误', () => {
  const issues = validateComposeSemantics(`
services:
  web:
    image: nginx
    depends_on:
      db:
        condition: service_healthy
  db:
    image: postgres
`);
  assert.equal(issues.filter((issue) => issue.level === 'error').length, 0);
});

test('compose-validator: 端口冲突检测', () => {
  const issues = validateComposeSemantics(`
services:
  a:
    image: nginx
    ports: ["8080:80"]
  b:
    image: httpd
    ports: ["8080:80"]
`);
  assert.ok(issues.some((issue) => issue.level === 'error' && /端口映射/.test(issue.message)));
});

test('compose-validator: 缺 image/build 警告', () => {
  const issues = validateComposeSemantics(`
services:
  web:
    command: sleep 1
`);
  assert.ok(issues.some((issue) => issue.level === 'warn' && /未声明 image/.test(issue.message)));
});

test('compose-validator: 非法 YAML 返回解析错误', () => {
  const issues = validateComposeSemantics('services:\n  web: [unclosed');
  assert.ok(issues.some((issue) => issue.level === 'error' && /YAML 解析失败/.test(issue.message)));
});

test('compose-preview: 区分新增/变更/移除服务', () => {
  const project = {
    containers: [
      { name: 'app-web-1', state: 'running', image: 'nginx' },
      { name: 'app-db-1', state: 'running', image: 'postgres' },
    ],
  };
  const oldContent = `
services:
  web:
    image: nginx
  db:
    image: postgres
`;
  const newContent = `
services:
  web:
    image: nginx:alpine
    environment:
      FOO: bar
  db:
    image: postgres
  redis:
    image: redis
`;
  const preview = previewComposeChange(newContent, project);
  assert.deepEqual(preview.added.map((item) => item.service), ['redis']);
  assert.ok(preview.changed.some((item) => item.service === 'web'));
  assert.ok(preview.removed.length === 0);
  assert.ok(!preview.changed.some((item) => item.service === 'db'));
});
