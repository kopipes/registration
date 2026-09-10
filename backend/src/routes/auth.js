'use strict';

const bcrypt = require('bcryptjs');
const { getDb } = require('../db/schema');
const { log } = require('../services/audit');

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
    const db = getDb();

    const user = db.prepare(
      'SELECT * FROM users WHERE username = ? AND is_active = 1'
    ).get(username.trim().toLowerCase());

    if (!user || !bcrypt.compareSync(password, user.password)) {
      log({
        action: 'LOGIN_FAILED',
        detail: { username },
        ipAddress: request.ip,
      });
      return reply.code(401).send({ error: 'Username atau password salah' });
    }

    const token = fastify.jwt.sign({
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
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
      },
    };
  });

  // GET /api/auth/me
  fastify.get('/me', {
    onRequest: [fastify.authenticate],
  }, async (request) => {
    const db = getDb();
    const user = db.prepare(
      'SELECT id, username, full_name, role FROM users WHERE id = ? AND is_active = 1'
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
