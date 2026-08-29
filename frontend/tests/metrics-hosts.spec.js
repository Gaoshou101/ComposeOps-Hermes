import { describe, expect, it } from 'vitest';
import { normalizeMetricRow, pushHistory, metricAlert, formatBytes } from '../src/lib/metrics.js';
import { validateHostForm, isMasked, buildHostPayload, buildDockerHostEnv } from '../src/lib/hosts-utils.js';

describe('metrics utils', () => {
  it('normalizeMetricRow 归一化后端指标行', () => {
    const row = normalizeMetricRow({ containerId: 'abc', name: 'web', cpuPercent: '12.345', memUsage: 209715200, memLimit: 1073741824, memPercent: '19.5' });
    expect(row.cpuPercent).toBe(12.35);
    expect(row.memUsageMB).toBe(200);
    expect(row.memLimitMB).toBe(1024);
    expect(row.memPercent).toBe(19.5);
  });

  it('pushHistory 保留最近 N 个点', () => {
    const history = [];
    for (let i = 1; i <= 30; i += 1) history.push(i);
    const next = pushHistory(history, 31, 26);
    expect(next.length).toBe(26);
    expect(next[0]).toBe(6);
    expect(next[next.length - 1]).toBe(31);
  });

  it('metricAlert 按阈值触发告警', () => {
    expect(metricAlert({ cpuPercent: 90, memPercent: 10 })).toBe(true);
    expect(metricAlert({ cpuPercent: 10, memPercent: 95 })).toBe(true);
    expect(metricAlert({ cpuPercent: 50, memPercent: 50 })).toBe(false);
  });

  it('formatBytes 可读化字节数', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1073741824)).toBe('1.0 GB');
  });
});

describe('hosts utils', () => {
  it('validateHostForm 校验必填与端口', () => {
    expect(validateHostForm({})).toContain('节点名称不能为空');
    expect(validateHostForm({ name: 'x', type: 'tcp', host: '', port: 2375 })).toContain('请填写主机地址');
    expect(validateHostForm({ name: 'x', type: 'ssh', host: 'h', port: 70000 })).toContain('SSH 端口需在 1-65535 之间');
    expect(validateHostForm({ name: 'x', type: 'ssh', host: 'h', port: 22 })).toEqual([]);
  });

  it('buildHostPayload 掩码字段不覆盖旧凭据', () => {
    const payload = buildHostPayload({ name: 'w', type: 'ssh', host: 'h', port: 22, username: 'root', password: '••••abc', privateKey: '' });
    expect(payload.password).toBeUndefined();
    const clear = buildHostPayload({ name: 'w', type: 'ssh', host: 'h', port: 22, username: 'root', password: 'newpw' });
    expect(clear.password).toBe('newpw');
    expect(isMasked('••••abc')).toBe(true);
    expect(isMasked('plain')).toBe(false);
  });

  it('buildDockerHostEnv 生成 ssh/tcp DOCKER_HOST', () => {
    expect(buildDockerHostEnv({ type: 'ssh', host: '10.0.0.1', port: 2222, username: 'dev' })).toBe('ssh://dev@10.0.0.1:2222');
    expect(buildDockerHostEnv({ type: 'tcp', host: '10.0.0.2', port: 2376 })).toBe('tcp://10.0.0.2:2376');
    expect(buildDockerHostEnv({ type: 'local' })).toBe('');
  });
});
