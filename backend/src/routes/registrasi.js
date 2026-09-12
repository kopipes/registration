'use strict';

const { getDb } = require('../db/schema');
const { log } = require('../services/audit');

module.exports = async function (fastify) {
  // GET /api/registrasi — list all with latest registration status
  fastify.get('/', {
    onRequest: [fastify.authenticate],
  }, async (request) => {
    const db = getDb();
    const rows = db.prepare(`
      SELECT
        p.*,
        r.id         AS reg_id,
        r.status     AS reg_status,
        r.registered_at,
        r.cancelled_at,
        ru.full_name AS registered_by_name,
        cu.full_name AS cancelled_by_name
      FROM peserta p
      LEFT JOIN registrations r ON r.peserta_id = p.id
        AND r.id = (
          SELECT id FROM registrations
          WHERE peserta_id = p.id
          ORDER BY created_at DESC LIMIT 1
        )
      LEFT JOIN users ru ON ru.id = r.registered_by
      LEFT JOIN users cu ON cu.id = r.cancelled_by
      WHERE p.is_active = 1
      ORDER BY p.nama ASC
    `).all();

    return rows.map(r => maskNik(r, request.user.role));
  });

  // POST /api/registrasi/:id/checkin
  fastify.post('/:id/checkin', {
    onRequest: [fastify.authenticate],
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const db = getDb();
    const pesertaId = Number(request.params.id);

    const peserta = db.prepare('SELECT * FROM peserta WHERE id = ? AND is_active = 1 AND project_id = ?').get(pesertaId, request.projectId);
    if (!peserta) return reply.code(404).send({ error: 'Peserta tidak ditemukan' });

    // Check if already registered (last status = registered)
    const lastReg = db.prepare(`
      SELECT * FROM registrations WHERE peserta_id = ? ORDER BY created_at DESC LIMIT 1
    `).get(pesertaId);

    if (lastReg && lastReg.status === 'registered') {
      return reply.code(409).send({ error: 'Peserta sudah terdaftar (sudah check-in)' });
    }

    const result = db.prepare(`
      INSERT INTO registrations (peserta_id, status, registered_by, registered_at)
      VALUES (?, 'registered', ?, datetime('now','localtime'))
    `).run(pesertaId, request.user.id);

    log({
      userId: request.user.id,
      username: request.user.username,
      action: 'CHECKIN',
      entity: 'peserta',
      entityId: pesertaId,
      projectId: request.projectId,
      detail: { peserta_nama: peserta.nama, peserta_nik: peserta.nik },
      ipAddress: request.ip,
    });

    return { message: 'Check-in berhasil', registration_id: result.lastInsertRowid };
  });

  // POST /api/registrasi/:id/unregister
  fastify.post('/:id/unregister', {
    onRequest: [fastify.authenticate],
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: { reason: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const db = getDb();
    const pesertaId = Number(request.params.id);
    const reason = request.body?.reason || null;

    const peserta = db.prepare('SELECT * FROM peserta WHERE id = ? AND is_active = 1 AND project_id = ?').get(pesertaId, request.projectId);
    if (!peserta) return reply.code(404).send({ error: 'Peserta tidak ditemukan' });

    const lastReg = db.prepare(`
      SELECT * FROM registrations WHERE peserta_id = ? ORDER BY created_at DESC LIMIT 1
    `).get(pesertaId);

    if (!lastReg || lastReg.status !== 'registered') {
      return reply.code(409).send({ error: 'Peserta belum check-in' });
    }

    db.prepare(`
      UPDATE registrations
      SET status = 'cancelled', cancelled_by = ?, cancelled_at = datetime('now','localtime'), cancel_reason = ?
      WHERE id = ?
    `).run(request.user.id, reason, lastReg.id);

    log({
      userId: request.user.id,
      username: request.user.username,
      action: 'UNREGISTER',
      entity: 'peserta',
      entityId: pesertaId,
      projectId: request.projectId,
      detail: { peserta_nama: peserta.nama, peserta_nik: peserta.nik, reason },
      ipAddress: request.ip,
    });

    return { message: 'Unregister berhasil' };
  });

  // GET /api/registrasi/history/:id — full registration history for a peserta
  fastify.get('/history/:id', {
    onRequest: [fastify.authenticate],
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const db = getDb();
    const pesertaId = Number(request.params.id);

    const peserta = db.prepare('SELECT * FROM peserta WHERE id = ? AND project_id = ?').get(pesertaId, request.projectId);
    if (!peserta) return reply.code(404).send({ error: 'Peserta tidak ditemukan' });

    const history = db.prepare(`
      SELECT
        r.*,
        ru.full_name AS registered_by_name,
        cu.full_name AS cancelled_by_name
      FROM registrations r
      LEFT JOIN users ru ON ru.id = r.registered_by
      LEFT JOIN users cu ON cu.id = r.cancelled_by
      WHERE r.peserta_id = ?
      ORDER BY r.created_at DESC
    `).all(pesertaId);

    return { peserta: maskNik(peserta, request.user.role), history };
  });
};

function maskNik(row, role) {
  if (role === 'crew' && row.nik) {
    return { ...row, nik: row.nik.slice(0, 4) + '****' + row.nik.slice(-4) };
  }
  return row;
}
