import { getSetting, setSetting } from '../lib/db.js';

const DEFAULTS = {
  enabled: false,
  type: 'bark',
  endpoint: '',
  token: '',
  chatId: '',
  memoryThreshold: 90,
  dockerStorageThresholdGb: 50,
  intervalSeconds: 60,
  smtpHost: '',
  smtpPort: 465,
  smtpSecure: true,
  smtpUser: '',
  smtpPassword: '',
  emailFrom: '',
  emailTo: '',
};

export function getNotificationConfig(maskSecrets = false) {
  let saved = {};
  try { saved = JSON.parse(getSetting('notifications.config', '{}')); } catch {}
  const config = { ...DEFAULTS, ...saved };
  if (maskSecrets) {
    if (config.token) config.token = 'configured';
    if (config.smtpPassword) config.smtpPassword = 'configured';
  }
  return config;
}

export function saveNotificationConfig(input = {}) {
  const current = getNotificationConfig(false);
  const allowedTypes = ['bark', 'telegram', 'wecom', 'email', 'webhook'];
  const next = { ...current };
  for (const key of Object.keys(DEFAULTS)) {
    if (input[key] !== undefined && input[key] !== 'configured') next[key] = input[key];
  }
  if (!allowedTypes.includes(next.type)) throw new Error('不支持的通知类型');
  next.memoryThreshold = Math.max(1, Math.min(Number(next.memoryThreshold) || 90, 100));
  next.dockerStorageThresholdGb = Math.max(1, Number(next.dockerStorageThresholdGb) || 50);
  next.intervalSeconds = Math.max(30, Math.min(Number(next.intervalSeconds) || 60, 3600));
  next.smtpPort = Math.max(1, Math.min(Number(next.smtpPort) || 465, 65535));
  setSetting('notifications.config', JSON.stringify(next));
  return getNotificationConfig(true);
}

async function postJson(url, body, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`通知服务返回 ${response.status}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function sendNotification(title, body, override = null) {
  const config = override || getNotificationConfig(false);
  if (!config.enabled && !override) return { skipped: true };
  if (config.type === 'bark') {
    if (!config.endpoint) throw new Error('未配置 Bark 地址');
    await postJson(config.endpoint, { title, body, group: 'ComposeOps' });
  } else if (config.type === 'telegram') {
    if (!config.token || !config.chatId) throw new Error('未配置 Telegram Token/Chat ID');
    await postJson(`https://api.telegram.org/bot${config.token}/sendMessage`, {
      chat_id: config.chatId,
      text: `${title}\n${body}`,
    });
  } else if (config.type === 'wecom') {
    if (!config.endpoint) throw new Error('未配置企业微信 Webhook');
    await postJson(config.endpoint, { msgtype: 'text', text: { content: `${title}\n${body}` } });
  } else if (config.type === 'webhook') {
    if (!config.endpoint) throw new Error('未配置 Webhook');
    await postJson(config.endpoint, { title, body, source: 'ComposeOps', timestamp: new Date().toISOString() });
  } else if (config.type === 'email') {
    const nodemailer = (await import('nodemailer')).default;
    const transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: !!config.smtpSecure,
      auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPassword } : undefined,
    });
    await transporter.sendMail({
      from: config.emailFrom || config.smtpUser,
      to: config.emailTo,
      subject: title,
      text: body,
    });
  }
  return { ok: true };
}
