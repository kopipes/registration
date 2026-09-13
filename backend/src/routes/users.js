'use strict';

const bcrypt = require('bcryptjs');
const { getDb } = require('../db/schema');
const { log } = require('../services/audit');

module.exports = async function (fastify) {
  // GET /api/users — Admin only
  fastify.get('/', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Akses ditolak' });
    }
    const db = getDb();
    const users = db.prepare(`
      SELECT u.id, u.username, u.full_name, u.role, u.project_id, u.is_active, u.created_at,
             p.name AS project_name, p.event_name AS project_event_name
      FROM users u
      LEFT JOIN projects p ON p.id = u.project_id
      ORDER BY u.created_at DESC
    `).all();
    return users;
  });

  // POST /api/users — create user (Admin only)
  fastify.post('/', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['username', 'password', 'full_name', 'role'],
        properties: {
          username: { type: 'string', minLength: 3 },
          password: { type: 'string', minLength: 6 },
          full_name: { type: 'string' },
          role: { type: 'string', enum: ['admin', 'official', 'crew'] },
          project_id: { type: 'integer' },
        },
      },
    },
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Akses ditolak' });
    }

    const db = getDb();
    const { username, password, full_name, role, project_id } = request.body;

    let assignedProjectId = null;
    if (role === 'crew') {
      if (!project_id) return reply.code(400).send({ error: 'Project wajib dipilih untuk akun Crew' });
      const project = db.prepare("SELECT id FROM projects WHERE id = ? AND status = 'active'").get(project_id);
      if (!project) return reply.code(400).send({ error: 'Project Crew tidak valid atau sudah diarsipkan' });
      assignedProjectId = project.id;
    }

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim().toLowerCase());
    if (existing) return reply.code(409).send({ error: 'Username sudah digunakan' });

    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare(`
      INSERT INTO users (username, password, full_name, role, project_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(username.trim().toLowerCase(), hash, full_name.trim(), role, assignedProjectId);

    log({
      userId: request.user.id,
      username: request.user.username,
      action: 'CREATE_USER',
      entity: 'users',
      entityId: result.lastInsertRowid,
      detail: { username, full_name, role, project_id: assignedProjectId },
      ipAddress: request.ip,
    });

    return { id: result.lastInsertRowid, message: 'User berhasil dibuat' };
  });

  // PUT /api/users/:id — edit user (Admin only)
  fastify.put('/:id', {
    onRequest: [fastify.authenticate],
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: {
          username:  { type: 'string', minLength: 3 },
          full_name: { type: 'string' },
          role:      { type: 'string', enum: ['admin', 'official', 'crew'] },
          password:  { type: 'string', minLength: 6 },
          is_active: { type: 'integer', enum: [0, 1] },
          project_id: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
        },
      },
    },
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Akses ditolak' });
    }

    const db = getDb();
    const id = Number(request.params.id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) return reply.code(404).send({ error: 'User tidak ditemukan' });

    const { username, full_name, role, password, is_active, project_id } = request.body;
    const hash = password ? bcrypt.hashSync(password, 10) : user.password;
    const finalRole = role ?? user.role;
    let assignedProjectId = finalRole === 'crew'
      ? (project_id === undefined ? user.project_id : project_id)
      : null;

    if (finalRole === 'crew') {
      if (!assignedProjectId) return reply.code(400).send({ error: 'Project wajib dipilih untuk akun Crew' });
      const project = db.prepare("SELECT id FROM projects WHERE id = ? AND status = 'active'").get(assignedProjectId);
      if (!project) return reply.code(400).send({ error: 'Project Crew tidak valid atau sudah diarsipkan' });
      assignedProjectId = project.id;
    }

    // Check username uniqueness if changed
    if (username && username.trim().toLowerCase() !== user.username) {
      const existing = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username.trim().toLowerCase(), id);
      if (existing) return reply.code(409).send({ error: 'Username sudah digunakan' });
    }

    // Revoke existing sessions if password changed or account disabled
    const shouldRevoke = !!password || (is_active !== undefined && is_active === 0) ||
      finalRole !== user.role || assignedProjectId !== user.project_id;

    db.prepare(`
      UPDATE users SET
        username = ?, full_name = ?, role = ?, project_id = ?, password = ?, is_active = ?,
        token_version = token_version + ?,
        updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(
      username ? username.trim().toLowerCase() : user.username,
      full_name ?? user.full_name,
      finalRole,
      assignedProjectId,
      hash,
      is_active ?? user.is_active,
      shouldRevoke ? 1 : 0,
      id
    );

    log({
      userId: request.user.id,
      username: request.user.username,
      action: 'EDIT_USER',
      entity: 'users',
      entityId: id,
      detail: { username, full_name, role, project_id: assignedProjectId, is_active, password_changed: !!password },
      ipAddress: request.ip,
    });

    return { message: 'User berhasil diupdate' };
  });

  // DELETE /api/users/:id/permanent — hard delete (Admin only, cannot delete own account)
  fastify.delete('/:id/permanent', {
    onRequest: [fastify.authenticate],
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Akses ditolak' });
    }

    const id = Number(request.params.id);
    if (id === request.user.id) {
      return reply.code(400).send({ error: 'Tidak bisa menghapus akun sendiri' });
    }

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) return reply.code(404).send({ error: 'User tidak ditemukan' });

    db.prepare('DELETE FROM users WHERE id = ?').run(id);

    log({
      userId: request.user.id,
      username: request.user.username,
      action: 'DELETE_USER',
      entity: 'users',
      entityId: id,
      detail: { username: user.username, full_name: user.full_name },
      ipAddress: request.ip,
    });

    return { message: 'User berhasil dihapus permanen' };
  });

  // DELETE /api/users/:id — deactivate (Admin only, cannot deactivate own account)
  fastify.delete('/:id', {
    onRequest: [fastify.authenticate],
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Akses ditolak' });
    }

    const id = Number(request.params.id);
    if (id === request.user.id) {
      return reply.code(400).send({ error: 'Tidak bisa menonaktifkan akun sendiri' });
    }

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) return reply.code(404).send({ error: 'User tidak ditemukan' });

    db.prepare(`UPDATE users SET is_active = 0, token_version = token_version + 1,
                updated_at = datetime('now','localtime') WHERE id = ?`).run(id);

    log({
      userId: request.user.id,
      username: request.user.username,
      action: 'DEACTIVATE_USER',
      entity: 'users',
      entityId: id,
      detail: { username: user.username },
      ipAddress: request.ip,
    });

    return { message: 'User berhasil dinonaktifkan' };
  });

  // PUT /api/users/change-password — change own password
  fastify.put('/change-password', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['old_password', 'new_password'],
        properties: {
          old_password: { type: 'string' },
          new_password: { type: 'string', minLength: 6 },
        },
      },
    },
  }, async (request, reply) => {
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(request.user.id);

    if (!bcrypt.compareSync(request.body.old_password, user.password)) {
      return reply.code(400).send({ error: 'Password lama salah' });
    }

    const hash = bcrypt.hashSync(request.body.new_password, 10);
    db.prepare(`UPDATE users SET password = ?, token_version = token_version + 1,
                updated_at = datetime('now','localtime') WHERE id = ?`).run(hash, user.id);

    log({
      userId: user.id,
      username: user.username,
      action: 'CHANGE_PASSWORD',
      entity: 'users',
      entityId: user.id,
      ipAddress: request.ip,
    });

    return { message: 'Password berhasil diubah' };
  });
};
