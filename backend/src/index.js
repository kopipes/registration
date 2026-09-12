'use strict';

require('dotenv').config();

const fastify = require('fastify')({ logger: true });
const path = require('path');
const fs = require('fs');
const { initDb, getDb } = require('./db/schema');
const { setupBackup } = require('./services/backup');

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || './data/registration.db';
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

// Ensure upload dir exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

async function start() {
  // Init database
  initDb(path.resolve(DB_PATH));
  const db = getDb();

  // Plugins
  await fastify.register(require('@fastify/cors'), {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
  });

  await fastify.register(require('@fastify/jwt'), {
    secret: process.env.JWT_SECRET || 'fallback_secret_change_in_production',
    sign: { expiresIn: process.env.JWT_EXPIRES_IN || '8h' },
  });

  await fastify.register(require('@fastify/multipart'), {
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  });

  await fastify.register(require('@fastify/static'), {
    root: path.resolve(UPLOAD_DIR),
    prefix: '/uploads/',
    decorateReply: false,
  });

  // Auth decorator
  fastify.decorate('authenticate', async function (request, reply) {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  fastify.decorate('requireRole', function (roles) {
    return async function (request, reply) {
      await fastify.authenticate(request, reply);
      if (!roles.includes(request.user.role)) {
        reply.code(403).send({ error: 'Forbidden' });
      }
    };
  });

  // Project scoping: validate X-Project-Id header, attach request.projectId.
  // Public routes (login, projects list) skip this via options.config.skipProject.
  fastify.addHook('onRequest', async (request, reply) => {
    // Only scope /api routes that need it
    const url = request.url.split('?')[0];
    if (!url.startsWith('/api/')) return;

    // Skip project requirement for these paths
    const skipPaths = [
      '/api/auth', '/api/health',
      '/api/projects', '/api/projects/',
    ];
    if (skipPaths.some(p => url === p || url.startsWith(p + '/'))) return;
    // /api/projects itself needs scoping only for nested mutations — handled in route

    const headerValue = request.headers['x-project-id'];
    if (!headerValue) {
      return reply.code(400).send({ error: 'Project tidak dipilih (X-Project-Id header wajib)' });
    }
    const projectId = Number(headerValue);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return reply.code(400).send({ error: 'X-Project-Id tidak valid' });
    }
    const project = db.prepare('SELECT id, status FROM projects WHERE id = ?').get(projectId);
    if (!project) {
      return reply.code(404).send({ error: 'Project tidak ditemukan' });
    }
    if (project.status === 'archived') {
      return reply.code(403).send({ error: 'Project sudah diarsipkan' });
    }
    request.projectId = projectId;
  });

  // Routes
  await fastify.register(require('./routes/auth'), { prefix: '/api/auth' });
  await fastify.register(require('./routes/projects'), { prefix: '/api/projects' });
  await fastify.register(require('./routes/peserta'), { prefix: '/api/peserta' });
  await fastify.register(require('./routes/registrasi'), { prefix: '/api/registrasi' });
  await fastify.register(require('./routes/users'), { prefix: '/api/users' });
  await fastify.register(require('./routes/dashboard'), { prefix: '/api/dashboard' });
  await fastify.register(require('./routes/settings'), { prefix: '/api/settings' });
  await fastify.register(require('./routes/export'), { prefix: '/api/export' });

  // Health check
  fastify.get('/api/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // Setup auto-backup
  setupBackup();

  await fastify.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`Server running on port ${PORT}`);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
