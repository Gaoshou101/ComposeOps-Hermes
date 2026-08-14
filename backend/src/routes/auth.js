import {
  changePassword,
  clearSession,
  isAuthenticated,
  isConfigured,
  issueSession,
  setPassword,
  verifyPassword,
} from '../lib/auth.js';

export default async function authRoutes(fastify) {
  const attempts = new Map();
  fastify.get('/status', async (request) => ({
    setupRequired: !isConfigured(),
    authenticated: isAuthenticated(request),
  }));

  fastify.post('/setup', async (request, reply) => {
    if (isConfigured()) return reply.code(409).send({ error: 'already_configured' });
    try {
      setPassword(request.body?.password);
      issueSession(reply, request.protocol === 'https');
      return { ok: true };
    } catch (error) {
      return reply.code(400).send({ error: 'invalid_password', message: error.message });
    }
  });

  fastify.post('/login', async (request, reply) => {
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

  fastify.post('/password', async (request, reply) => {
    try {
      changePassword(request.body?.currentPassword, request.body?.nextPassword);
      issueSession(reply, request.protocol === 'https');
      return { ok: true };
    } catch (error) {
      return reply.code(400).send({ error: 'password_change_failed', message: error.message });
    }
  });
}
