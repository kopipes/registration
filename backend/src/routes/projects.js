'use strict';

const { getDb } = require('../db/schema');
const { log } = require('../services/audit');
const path = require('path');
const fs = require('fs');

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

module.exports = async function (fastify) {
  // GET /api/projects — list all (with stats)
  fastify.get('/', {
    onRequest: [fastify.authenticate],
  }, async (request) => {
    const db = getDb();
    const includeArchived = request.query.archived === '1';
    const rows = db.prepare(`
      SELECT
        p.*,
        (SELECT COUNT(*) FROM peserta x WHERE x.project_id = p.id AND x.is_active = 1) AS peserta_count,
        (SELECT COUNT(*) FROM peserta x
          JOIN registrations r ON r.peserta_id = x.id AND r.status = 'registered'
          WHERE x.project_id = p.id AND x.is_active = 1) AS registered_count
      FROM projects p
      ${includeArchived ? '' : "WHERE p.status = 'active'"}
      ORDER BY p.created_at DESC
    `).all();
    return rows;
  });

  // GET /api/projects/:id — single project
  fastify.get('/:id', {
    onRequest: [fastify.authenticate],
    schema: { params: { type: 'object', properties: { id: { type: 'integer' } } } },
  }, async (request, reply) => {
    const db = getDb();
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(request.params.id));
    if (!project) return reply.code(404).send({ error: 'Project tidak ditemukan' });
    return project;
  });

  // POST /api/projects — create (Admin only)
  fastify.post('/', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1 },
          description: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Hanya Admin yang bisa membuat project' });
    }
    const db = getDb();
    const { name, description } = request.body;
    const result = db.prepare(`
      INSERT INTO projects (name, description)
      VALUES (?, ?)
    `).run(name.trim(), description?.trim() || null);

    log({
      userId: request.user.id,
      username: request.user.username,
      action: 'CREATE_PROJECT',
      entity: 'projects',
      entityId: result.lastInsertRowid,
      projectId: result.lastInsertRowid,
      detail: { name },
      ipAddress: request.ip,
    });

    return { id: result.lastInsertRowid, message: 'Project berhasil dibuat' };
  });

  // PUT /api/projects/:id — update name/description (Admin only)
  fastify.put('/:id', {
    onRequest: [fastify.authenticate],
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 },
          description: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Hanya Admin yang bisa edit project' });
    }
    const db = getDb();
    const id = Number(request.params.id);
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return reply.code(404).send({ error: 'Project tidak ditemukan' });

    const { name, description } = request.body;
    db.prepare(`
      UPDATE projects SET name = ?, description = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      name?.trim() ?? project.name,
      description?.trim() ?? project.description,
      id
    );

    log({
      userId: request.user.id,
      username: request.user.username,
      action: 'EDIT_PROJECT',
      entity: 'projects',
      entityId: id,
      projectId: id,
      detail: { name, description },
      ipAddress: request.ip,
    });

    return { message: 'Project berhasil diupdate' };
  });

  // POST /api/projects/:id/archive — archive project (Admin only)
  fastify.post('/:id/archive', {
    onRequest: [fastify.authenticate],
    schema: { params: { type: 'object', properties: { id: { type: 'integer' } } } },
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Hanya Admin yang bisa mengarsipkan project' });
    }
    const db = getDb();
    const id = Number(request.params.id);
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return reply.code(404).send({ error: 'Project tidak ditemukan' });
    if (project.status === 'archived') {
      return reply.code(400).send({ error: 'Project sudah diarsipkan' });
    }

    db.prepare("UPDATE projects SET status = 'archived', updated_at = datetime('now') WHERE id = ?").run(id);

    log({
      userId: request.user.id,
      username: request.user.username,
      action: 'ARCHIVE_PROJECT',
      entity: 'projects',
      entityId: id,
      projectId: id,
      detail: { name: project.name },
      ipAddress: request.ip,
    });

    return { message: 'Project berhasil diarsipkan' };
  });

  // POST /api/projects/:id/unarchive — restore archived project (Admin only)
  fastify.post('/:id/unarchive', {
    onRequest: [fastify.authenticate],
    schema: { params: { type: 'object', properties: { id: { type: 'integer' } } } },
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Hanya Admin yang bisa restore project' });
    }
    const db = getDb();
    const id = Number(request.params.id);
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return reply.code(404).send({ error: 'Project tidak ditemukan' });
    if (project.status !== 'archived') {
      return reply.code(400).send({ error: 'Project belum diarsipkan' });
    }

    db.prepare("UPDATE projects SET status = 'active', updated_at = datetime('now') WHERE id = ?").run(id);

    log({
      userId: request.user.id,
      username: request.user.username,
      action: 'UNARCHIVE_PROJECT',
      entity: 'projects',
      entityId: id,
      projectId: id,
      detail: { name: project.name },
      ipAddress: request.ip,
    });

    return { message: 'Project berhasil diaktifkan kembali' };
  });

  // POST /api/projects/:id/logo — upload logo for project (Admin only)
  fastify.post('/:id/logo', {
    onRequest: [fastify.authenticate],
    schema: { params: { type: 'object', properties: { id: { type: 'integer' } } } },
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Akses ditolak' });
    }
    const db = getDb();
    const id = Number(request.params.id);
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return reply.code(404).send({ error: 'Project tidak ditemukan' });

    const data = await request.file();
    if (!data) return reply.code(400).send({ error: 'File tidak ditemukan' });

    const ext = path.extname(data.filename).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.svg', '.webp'].includes(ext)) {
      return reply.code(400).send({ error: 'Format file tidak didukung. Gunakan PNG, JPG, SVG, atau WebP' });
    }

    // Remove old project logo if exists
    if (project.logo_url) {
      const old = path.join(path.resolve(UPLOAD_DIR), path.basename(project.logo_url));
      if (fs.existsSync(old)) fs.unlinkSync(old);
    }

    const filename = `project-${id}-logo${ext}`;
    const filepath = path.join(path.resolve(UPLOAD_DIR), filename);
    const chunks = [];
    for await (const chunk of data.file) chunks.push(chunk);
    fs.writeFileSync(filepath, Buffer.concat(chunks));

    const logoUrl = `/uploads/${filename}`;
    db.prepare("UPDATE projects SET logo_url = ?, updated_at = datetime('now') WHERE id = ?").run(logoUrl, id);

    log({
      userId: request.user.id,
      username: request.user.username,
      action: 'UPLOAD_PROJECT_LOGO',
      entity: 'projects',
      entityId: id,
      projectId: id,
      detail: { filename },
      ipAddress: request.ip,
    });

    return { logo_url: logoUrl, message: 'Logo project berhasil diupload' };
  });

  // PUT /api/projects/:id/settings — update event_name & theme (Admin only)
  fastify.put('/:id/settings', {
    onRequest: [fastify.authenticate],
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: {
          event_name: { type: 'string' },
          theme: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Akses ditolak' });
    }
    const db = getDb();
    const id = Number(request.params.id);
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return reply.code(404).send({ error: 'Project tidak ditemukan' });

    const { event_name, theme } = request.body;
    db.prepare(`
      UPDATE projects SET event_name = ?, theme = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      event_name?.trim() ?? project.event_name,
      theme ?? project.theme,
      id
    );

    log({
      userId: request.user.id,
      username: request.user.username,
      action: 'UPDATE_PROJECT_SETTINGS',
      entity: 'projects',
      entityId: id,
      projectId: id,
      detail: { event_name, theme },
      ipAddress: request.ip,
    });

    return { message: 'Settings project berhasil disimpan' };
  });
};
