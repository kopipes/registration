'use strict';

const { getDb } = require('../db/schema');
const { log } = require('../services/audit');
const path = require('path');
const fs = require('fs');

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

module.exports = async function (fastify) {
  // GET /api/settings — public, no auth required (only returns logo_url and event_name)
  fastify.get('/', async () => {
    const db = getDb();
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    return settings;
  });

  // POST /api/settings/logo — upload logo (Admin only)
  fastify.post('/logo', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Akses ditolak' });
    }

    const data = await request.file();
    if (!data) return reply.code(400).send({ error: 'File tidak ditemukan' });

    const ext = path.extname(data.filename).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.svg', '.webp'].includes(ext)) {
      return reply.code(400).send({ error: 'Format file tidak didukung. Gunakan PNG, JPG, SVG, atau WebP' });
    }

    const filename = `logo${ext}`;
    const filepath = path.join(path.resolve(UPLOAD_DIR), filename);

    // Remove old logo files
    ['.png', '.jpg', '.jpeg', '.svg', '.webp'].forEach(e => {
      const old = path.join(path.resolve(UPLOAD_DIR), `logo${e}`);
      if (fs.existsSync(old)) fs.unlinkSync(old);
    });

    const chunks = [];
    for await (const chunk of data.file) {
      chunks.push(chunk);
    }
    fs.writeFileSync(filepath, Buffer.concat(chunks));

    const logoUrl = `/uploads/${filename}`;
    const db = getDb();
    db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES ('logo_url', ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(logoUrl);

    log({
      userId: request.user.id,
      username: request.user.username,
      action: 'UPLOAD_LOGO',
      detail: { filename },
      ipAddress: request.ip,
    });

    return { logo_url: logoUrl, message: 'Logo berhasil diupload' };
  });

  // DELETE /api/settings/logo — remove logo (Admin only)
  fastify.delete('/logo', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Akses ditolak' });
    }

    const db = getDb();
    const setting = db.prepare("SELECT value FROM settings WHERE key = 'logo_url'").get();
    if (setting?.value) {
      const filepath = path.join(path.resolve(UPLOAD_DIR), path.basename(setting.value));
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    }

    db.prepare("DELETE FROM settings WHERE key = 'logo_url'").run();

    log({
      userId: request.user.id,
      username: request.user.username,
      action: 'DELETE_LOGO',
      ipAddress: request.ip,
    });

    return { message: 'Logo berhasil dihapus' };
  });

  // PUT /api/settings — update general settings (Admin only)
  fastify.put('/', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          event_name: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Akses ditolak' });
    }

    const db = getDb();
    const allowed = ['event_name', 'theme'];
    const upsert = db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);

    const upsertMany = db.transaction((entries) => {
      for (const [key, value] of entries) {
        upsert.run(key, String(value));
      }
    });

    const entries = Object.entries(request.body).filter(([k]) => allowed.includes(k));
    upsertMany(entries);

    log({
      userId: request.user.id,
      username: request.user.username,
      action: 'UPDATE_SETTINGS',
      detail: request.body,
      ipAddress: request.ip,
    });

    return { message: 'Settings berhasil disimpan' };
  });
};
