import {
  changePassword,
  clearSession,
  isAuthenticated,
  isConfigured,
  issueSession,
  setPassword,
  verifyPassword,
} from '../lib/auth.js';
import { getSetting, setSetting } from '../lib/db.js';

/**
 * 口令类字段只做类型与长度上限校验,不搬业务规则(如至少 10 位):
 * 1. setPassword/changePassword 已给出更友好的中文报错与 invalid_password 等机器码,
 *    若在 schema 里重复约束会把它们降级成通用的 validation_failed;
 * 2. /login 的失败计数依赖请求走到处理函数,提前 400 会让失败尝试不被计入限流。
 * maxLength 是必要的:scryptSync 对超长输入代价高,未登录接口需要防放大攻击。
 */
const PASSWORD_MAX = 200;
const passwordField = { type: 'string', maxLength: PASSWORD_MAX };

// 登录失败锁定:持久化到 SQLite(服务重启不重置),内存缓存减少读写。
const LOCKOUT_KEY = 'auth.login_lockouts';
let lockoutCache = null;

function loadLockouts() {
  if (lockoutCache) return lockoutCache;
  try {
    lockoutCache = new Map(Object.entries(JSON.parse(getSetting(LOCKOUT_KEY, '{}'))));
  } catch {
    lockoutCache = new Map();
  }
  return lockoutCache;
}

function saveLockouts() {
  const map = loadLockouts();
  const now = Date.now();
  for (const [key, entry] of map) {
    if (entry.resetAt <= now) map.delete(key);
  }
  setSetting(LOCKOUT_KEY, JSON.stringify(Object.fromEntries(map)));
}

export default async function authRoutes(fastify) {
  const attempts = {
    get: (key) => loadLockouts().get(key),
    set: (key, entry) => { loadLockouts().set(key, entry); saveLockouts(); },
    delete: (key) => { if (loadLockouts().delete(key)) saveLockouts(); },
  };
  fastify.get('/status', async (request) => ({
    setupRequired: !isConfigured(),
    authenticated: isAuthenticated(request),
  }));

  fastify.post('/setup', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: { password: passwordField },
      },
    },
  }, async (request, reply) => {
    if (isConfigured()) return reply.code(409).send({ error: 'already_configured' });
    try {
      setPassword(request.body?.password);
      issueSession(reply, request.protocol === 'https');
      return { ok: true };
    } catch (error) {
      return reply.code(400).send({ error: 'invalid_password', message: error.message });
    }
  });

  fastify.post('/login', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: { password: passwordField },
      },
    },
  }, async (request, reply) => {
    if (!isConfigured()) return reply.code(409).send({ error: 'setup_required' });
    const key = request.ip;
    const entry = attempts.get(key) || { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
    if (Date.now() > entry.resetAt) { entry.count = 0; entry.resetAt = Date.now() + 15 * 60 * 1000; }
    if (entry.count >= 5) return reply.code(429).send({ error: 'too_many_attempts', message: '登录失败次数过多，请稍后再试' });
    if (!verifyPassword(request.body?.password)) {
      entry.count += 1;
      attempts.set(key, entry);
      return reply.code(401).send({ error: 'invalid_credentials', message: '密码错误' });
    }
    attempts.delete(key);
    issueSession(reply, request.protocol === 'https');
    return { ok: true };
  });

  fastify.post('/logout', async (request, reply) => {
    clearSession(request, reply);
    return { ok: true };
  });

  fastify.post('/password', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: { currentPassword: passwordField, nextPassword: passwordField },
      },
    },
  }, async (request, reply) => {
    try {
      changePassword(request.body?.currentPassword, request.body?.nextPassword);
      issueSession(reply, request.protocol === 'https');
      return { ok: true };
    } catch (error) {
      return reply.code(400).send({ error: 'password_change_failed', message: error.message });
    }
  });
}
