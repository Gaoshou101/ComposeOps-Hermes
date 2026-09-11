import { describe, expect, it } from 'vitest';
import { stripAgentProtocol } from '../src/lib/agent-text.js';
import { renderAgentMarkdown } from '../src/lib/agent-markdown.js';

describe('Agent visible text protocol filter', () => {
  it('removes incomplete tool markers from streamed text', () => {
    expect(stripAgentProtocol('limburg<tool_ca当前你有以下项目')).toBe('limburg当前你有以下项目');
    expect(stripAgentProtocol('limburg<tool_当前你有以下项目')).toBe('limburg当前你有以下项目');
    expect(stripAgentProtocol('<tool_call>{"name":"project.list_managed"')).toBe('');
    expect(stripAgentProtocol('tool_ca')).toBe('');
  });

  it('removes the _icall protocol and preserves surrounding text', () => {
    expect(stripAgentProtocol('limburg_icall\n{"name":"project.list_managed","arguments":{}}>')).toBe('limburg');
    expect(stripAgentProtocol('前文_icall {"name":"x","arguments":{"nested":{"ok":true}}}>后文')).toBe('前文后文');
    expect(stripAgentProtocol('前文_icall {"name":"x"')).toBe('前文');
    expect(stripAgentProtocol('正在查询 _ic')).toBe('正在查询');
    expect(stripAgentProtocol('iNdEx++ result= composeOps.project.list_managed()project_ids=[...]project_list<tID | 项目名称 |\n|----|----||P1:x | composeops |您当前可以操作的项目如下:')).toBe('您当前可以操作的项目如下:');
    expect(stripAgentProtocol('```javascript\nfor (let index = 0; index < 3; index++) console.log(index);\n```')).toContain('index++');
  });

  it('renders markdown tables and code while sanitizing unsafe HTML', () => {
    const html = renderAgentMarkdown('## 项目\n\n| 名称 | 状态 |\n| --- | --- |\n| composeops | 运行中 |\n\n```yaml\nservices:\n  app:\n    image: nginx\n```\n\n<script>alert(1)</script>');
    expect(html).toContain('<h2>项目</h2>');
    expect(html).toContain('<table>');
    expect(html).toContain('<code class="language-yaml">');
    expect(html).not.toContain('<script');
  });

  it('repairs common compact AI markdown boundaries', () => {
    const html = renderAgentMarkdown('配置如下：| 服务 | 状态 |\n| --- | --- |\n| api | 运行 |\n\n```yamlservices:\n  api:\n    image: nginx\n```');
    expect(html).toContain('<table>');
    expect(html).toContain('<code class="language-yaml">services:');
  });

  it('splits compact table rows without changing shell code blocks', () => {
    const html = renderAgentMarkdown('您当前可以操作的项目如下:\n\n| ID | 项目名称 |\n|----|----||P1:x | composeops ||P2:y | mineru |\n\n```bash\nif a || b; then\n  echo ok\nfi\n```');
    expect(html).toContain('<table>');
    expect(html).toContain('composeops');
    expect(html).toContain('mineru');
    expect(html).toContain('a || b');
  });

  it('renders the reported project list shape as a real table', () => {
    const html = renderAgentMarkdown('您当前可以操作的项目如下:\n\n|ID| 项目名称|\n|------------|--------------------||P1:cec9b3b6| composeops||P2:ad877fd30bf4b42609033 | data-preprocessing||P3:dfc64511d273ef9249a7|mineru||P4:c8aea94fc3257194c1e1 |mineru-batch||P5:7e8b1cfa5239ffaf87d2|multi|');
    expect(html.match(/<table>/g)).toHaveLength(1);
    expect(html).toContain('composeops');
    expect(html).toContain('data-preprocessing');
    expect(html).toContain('mineru-batch');
  });
});
