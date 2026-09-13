'use strict';

const bcrypt = require('bcryptjs');
const { getDb } = require('../db/schema');
const { log } = require('../services/audit');

// --- Login rate limiting (in-memory, per username+IP) ---
// Blocks brute-force without adding a dependency. Resets on successful login.
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const attempts = new Map(); // key -> { count, firstAt, blockedUntil }

function rateKey(username, ip) {
  return `${String(username || '').toLowerCase()}|${ip}`;
}

function checkRateLimit(username, ip) {
  const key = rateKey(username, ip);
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec) return { allowed: true };

  if (rec.blockedUntil && now < rec.blockedUntil) {
    return { allowed: false, retryAfterSec: Math.ceil((rec.blockedUntil - now) / 1000) };
  }
  // Window expired → reset
  if (now - rec.firstAt > WINDOW_MS) {
    attempts.delete(key);
    return { allowed: true };
  }
  return { allowed: true };
}

function recordFailure(username, ip) {
  const key = rateKey(username, ip);
  const now = Date.now();
  const rec = attempts.get(key) || { count: 0, firstAt: now, blockedUntil: null };
  if (now - rec.firstAt > WINDOW_MS) { rec.count = 0; rec.firstAt = now; rec.blockedUntil = null; }
  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS) {
    rec.blockedUntil = now + WINDOW_MS;
  }
  attempts.set(key, rec);
}

function clearFailures(username, ip) {
  attempts.delete(rateKey(username, ip));
}

// Periodic cleanup so the map can't grow unbounded
setInterval(() => {
  const now = Date.now();
  for (const [key, rec] of attempts) {
    const expired = now - rec.firstAt > WINDOW_MS && (!rec.blockedUntil || now > rec.blockedUntil);
    if (expired) attempts.delete(key);
  }
}, 5 * 60 * 1000).unref();


module.exports = async function (fastify) {
  // POST /api/auth/login
  fastify.post('/login', {
    schema: {
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string' },
          password: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { username, password } = request.body;

    // Brute-force protection
    const limit = checkRateLimit(username, request.ip);
    if (!limit.allowed) {
      log({
        action: 'LOGIN_RATE_LIMITED',
        detail: { username },
        ipAddress: request.ip,
      });
      reply.header('Retry-After', limit.retryAfterSec);
      return reply.code(429).send({
        error: `Terlalu banyak percobaan login. Coba lagi dalam ${Math.ceil(limit.retryAfterSec / 60)} menit.`,
      });
    }

    const db = getDb();

    const user = db.prepare(
      'SELECT * FROM users WHERE username = ? AND is_active = 1'
    ).get(username.trim().toLowerCase());

    if (!user || !bcrypt.compareSync(password, user.password)) {
      recordFailure(username, request.ip);
      log({
        action: 'LOGIN_FAILED',
        detail: { username },
        ipAddress: request.ip,
      });
      return reply.code(401).send({ error: 'Username atau password salah' });
    }

    if (user.role === 'crew') {
      const assignedProject = user.project_id
        ? db.prepare("SELECT id FROM projects WHERE id = ? AND status = 'active'").get(user.project_id)
        : null;
      if (!assignedProject) {
        return reply.code(403).send({ error: 'Akun Crew belum ditugaskan ke project aktif. Hubungi Admin.' });
      }
    }

    clearFailures(username, request.ip);

    const token = fastify.jwt.sign({
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
      project_id: user.project_id,
      token_version: user.token_version ?? 1,
    });

    log({
      userId: user.id,
      username: user.username,
      action: 'LOGIN',
      ipAddress: request.ip,
    });

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
        project_id: user.project_id,
      },
    };
  });

  // GET /api/auth/me
  fastify.get('/me', {
    onRequest: [fastify.authenticate],
  }, async (request) => {
    const db = getDb();
    const user = db.prepare(
      'SELECT id, username, full_name, role, project_id FROM users WHERE id = ? AND is_active = 1'
    ).get(request.user.id);

    if (!user) {
      return { error: 'User not found' };
    }
    return user;
  });

  // POST /api/auth/logout
  fastify.post('/logout', {
    onRequest: [fastify.authenticate],
  }, async (request) => {
    log({
      userId: request.user.id,
      username: request.user.username,
      action: 'LOGOUT',
      ipAddress: request.ip,
    });
    return { message: 'Logged out' };
  });
};
