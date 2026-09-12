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
      UPDATE projects SET name = ?, description = ?, updated_at = datetime('now','localtime')
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

    db.prepare("UPDATE projects SET status = 'archived', updated_at = datetime('now','localtime') WHERE id = ?").run(id);

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

    db.prepare("UPDATE projects SET status = 'active', updated_at = datetime('now','localtime') WHERE id = ?").run(id);

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
    db.prepare("UPDATE projects SET logo_url = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(logoUrl, id);

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

  // DELETE /api/projects/:id — permanent delete (Admin only, requires typed confirmation)
  fastify.delete('/:id', {
    onRequest: [fastify.authenticate],
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        required: ['confirm_name'],
        properties: { confirm_name: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Hanya Admin yang bisa menghapus project' });
    }

    const db = getDb();
    const id = Number(request.params.id);
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return reply.code(404).send({ error: 'Project tidak ditemukan' });

    // Typed confirmation must match the project name exactly (case-insensitive, trimmed)
    const expected = (project.event_name || project.name || '').trim().toLowerCase();
    const given = String(request.body.confirm_name || '').trim().toLowerCase();
    if (!expected || given !== expected) {
      return reply.code(400).send({
        error: 'Nama project tidak cocok. Ketik nama project dengan tepat untuk konfirmasi.',
      });
    }

    const counts = db.transaction(() => {
      const stats = {
        peserta: db.prepare('SELECT COUNT(*) c FROM peserta WHERE project_id = ?').get(id).c,
        registrations: db.prepare(`
          SELECT COUNT(*) c FROM registrations r
          JOIN peserta p ON p.id = r.peserta_id
          WHERE p.project_id = ?
        `).get(id).c,
        batches: db.prepare('SELECT COUNT(*) c FROM upload_batches WHERE project_id = ?').get(id).c,
        mappings: db.prepare('SELECT COUNT(*) c FROM upload_mappings WHERE project_id = ?').get(id).c,
      };

      // Delete children first (FK-safe order)
      db.prepare(`
        DELETE FROM registrations WHERE peserta_id IN (
          SELECT id FROM peserta WHERE project_id = ?
        )
      `).run(id);
      db.prepare('DELETE FROM peserta WHERE project_id = ?').run(id);
      db.prepare('DELETE FROM upload_mappings WHERE project_id = ?').run(id);
      db.prepare('DELETE FROM upload_batches WHERE project_id = ?').run(id);
      // Audit log keeps history, but drop the FK reference to the removed project
      db.prepare('UPDATE audit_log SET project_id = NULL WHERE project_id = ?').run(id);
      db.prepare('DELETE FROM projects WHERE id = ?').run(id);

      return stats;
    })();

    log({
      userId: request.user.id,
      username: request.user.username,
      action: 'DELETE_PROJECT',
      entity: 'projects',
      entityId: null, // project gone — avoid dangling reference
      detail: { name: project.name, event_name: project.event_name, ...counts },
      ipAddress: request.ip,
    });

    return {
      message: `Project "${project.event_name || project.name}" berhasil dihapus permanen`,
      deleted: counts,
    };
  });

  // PUT /api/projects/:id/settings — update event_name, theme & unique_fields (Admin only)
  fastify.put('/:id/settings', {
    onRequest: [fastify.authenticate],
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: {
          event_name: { type: 'string' },
          theme: { type: 'string' },
          unique_fields: {
            type: 'array',
            items: { type: 'string', enum: ['kode', 'nik', 'email', 'no_telpon'] },
          },
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

    const { event_name, theme, unique_fields } = request.body;

    let uniqueJson = project.unique_fields;
    if (Array.isArray(unique_fields)) {
      if (unique_fields.length === 0) {
        return reply.code(400).send({ error: 'Minimal satu patokan unik harus dipilih' });
      }
      uniqueJson = JSON.stringify([...new Set(unique_fields)]);
    }

    db.prepare(`
      UPDATE projects SET event_name = ?, theme = ?, unique_fields = ?, updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(
      event_name?.trim() ?? project.event_name,
      theme ?? project.theme,
      uniqueJson,
      id
    );

    log({
      userId: request.user.id,
      username: request.user.username,
      action: 'UPDATE_PROJECT_SETTINGS',
      entity: 'projects',
      entityId: id,
      projectId: id,
      detail: { event_name, theme, unique_fields },
      ipAddress: request.ip,
    });

    return { message: 'Settings project berhasil disimpan' };
  });
};
