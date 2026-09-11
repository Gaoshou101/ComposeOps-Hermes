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
});
