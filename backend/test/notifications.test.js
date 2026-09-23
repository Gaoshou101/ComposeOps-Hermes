import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'composeops-notifications-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');

const { getNotificationConfig, saveNotificationConfig } = await import('../src/services/notifications.js');

test('notifications: 旧版 bark 配置只落到 bark 渠道', () => {
  saveNotificationConfig({ enabled: true, type: 'bark', endpoint: 'https://bark.example/push' });
  const config = getNotificationConfig(false);
  const bark = config.channels.find((channel) => channel.type === 'bark');
  const webhook = config.channels.find((channel) => channel.type === 'webhook');
  assert.equal(bark.endpoint, 'https://bark.example/push');
  assert.equal(bark.enabled, true);
  assert.equal(webhook.endpoint, '');
  assert.equal(webhook.enabled, false);
});

test('notifications: 两个渠道各自独立保存', () => {
  saveNotificationConfig({
    channels: [
      { type: 'bark', enabled: true, endpoint: 'https://bark.example/a' },
      { type: 'webhook', enabled: true, endpoint: 'https://hook.example/b' },
    ],
  });
  const config = getNotificationConfig(false);
  const bark = config.channels.find((channel) => channel.type === 'bark');
  const webhook = config.channels.find((channel) => channel.type === 'webhook');
  assert.equal(bark.endpoint, 'https://bark.example/a');
  assert.equal(bark.enabled, true);
  assert.equal(webhook.endpoint, 'https://hook.example/b');
  assert.equal(webhook.enabled, true);
});

test('notifications: 脱敏后的 token 再次保存不会覆盖真实值', () => {
  saveNotificationConfig({
    channels: [{ type: 'telegram', enabled: true, token: 'secret-token', chatId: '123' }],
  });
  const masked = getNotificationConfig(true);
  const telegram = masked.channels.find((channel) => channel.type === 'telegram');
  assert.equal(telegram.token, 'configured');
  saveNotificationConfig({ channels: [{ type: 'telegram', enabled: true, token: 'configured', chatId: '123' }] });
  const stored = getNotificationConfig(false);
  assert.equal(stored.channels.find((channel) => channel.type === 'telegram').token, 'secret-token');
});
