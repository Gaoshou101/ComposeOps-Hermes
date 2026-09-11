import { describe, expect, it } from 'vitest';
import { stripAgentProtocol } from '../src/lib/agent-text.js';

describe('Agent visible text protocol filter', () => {
  it('removes incomplete tool markers from streamed text', () => {
    expect(stripAgentProtocol('limburg<tool_ca当前你有以下项目')).toBe('limburg当前你有以下项目');
    expect(stripAgentProtocol('limburg<tool_当前你有以下项目')).toBe('limburg当前你有以下项目');
    expect(stripAgentProtocol('<tool_call>{"name":"project.list_managed"')).toBe('');
    expect(stripAgentProtocol('tool_ca')).toBe('');
  });
});
