'use strict';

const { getDb } = require('../db/schema');
const { log } = require('../services/audit');
const path = require('path');

module.exports = async function (fastify) {
  // GET /api/peserta — universal search
  fastify.get('/', {
    onRequest: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          section: { type: 'string' },
          status: { type: 'string', enum: ['registered', 'cancelled', 'pending'] },
          limit: { type: 'integer', default: 50 },
          offset: { type: 'integer', default: 0 },
        },
      },
    },
  }, async (request) => {
    const db = getDb();
    const { q, section, status, limit = 50, offset = 0 } = request.query;

    let query = `
      SELECT
        p.*,
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
    `;
    const params = [];

    if (q && q.trim()) {
      const term = `%${q.trim()}%`;
      query += ` AND (
        p.nama LIKE ? OR
        p.nik LIKE ? OR
        p.email LIKE ? OR
        p.no_telpon LIKE ? OR
        p.seat LIKE ? OR
        p.section LIKE ?
      )`;
      params.push(term, term, term, term, term, term);
    }

    if (section) {
      query += ' AND p.section = ?';
      params.push(section);
    }

    if (status === 'registered') {
      query += " AND r.status = 'registered'";
    } else if (status === 'cancelled') {
      query += " AND r.status = 'cancelled'";
    } else if (status === 'pending') {
      query += ' AND r.id IS NULL';
    }

    // Count total
    const countQuery = `SELECT COUNT(*) as total FROM (${query})`;
    const { total } = db.prepare(countQuery).get(...params);

    query += ' ORDER BY p.nama ASC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = db.prepare(query).all(...params);

    return {
      total,
      limit,
      offset,
      data: rows.map(r => maskNik(r, request.user.role)),
    };
  });

  // GET /api/peserta/:id
  fastify.get('/:id', {
    onRequest: [fastify.authenticate],
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const db = getDb();
    const row = db.prepare(`
      SELECT
        p.*,
        r.status     AS reg_status,
        r.registered_at,
        r.cancelled_at,
        ru.full_name AS registered_by_name,
        cu.full_name AS cancelled_by_name
      FROM peserta p
      LEFT JOIN registrations r ON r.peserta_id = p.id
        AND r.id = (
          SELECT id FROM registrations WHERE peserta_id = p.id ORDER BY created_at DESC LIMIT 1
        )
      LEFT JOIN users ru ON ru.id = r.registered_by
      LEFT JOIN users cu ON cu.id = r.cancelled_by
      WHERE p.id = ? AND p.is_active = 1
    `).get(Number(request.params.id));

    if (!row) return reply.code(404).send({ error: 'Peserta tidak ditemukan' });
    return maskNik(row, request.user.role);
  });

  // POST /api/peserta — add manual (Admin only)
  fastify.post('/', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['nama', 'nik'],
        properties: {
          nama: { type: 'string' },
          nik: { type: 'string' },
          email: { type: 'string' },
          no_telpon: { type: 'string' },
          seat: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Hanya Admin yang bisa menambah peserta manual' });
    }

    const db = getDb();
    const { nama, nik, email, no_telpon, seat } = request.body;
    const { section, seat_number } = parseSeat(seat);

    // Check duplicate NIK
    const existing = db.prepare('SELECT id FROM peserta WHERE nik = ?').get(nik.trim());
    if (existing) return reply.code(409).send({ error: 'NIK sudah terdaftar' });

    const result = db.prepare(`
      INSERT INTO peserta (nama, nik, email, no_telpon, seat, section, seat_number)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      nama.trim(),
      nik.trim(),
      email?.trim() || null,
      no_telpon?.trim() || null,
      seat?.trim() || null,
      section,
      seat_number
    );

    log({
      userId: request.user.id,
      username: request.user.username,
      action: 'ADD_PESERTA',
      entity: 'peserta',
      entityId: result.lastInsertRowid,
      detail: { nama, nik },
      ipAddress: request.ip,
    });

    return { id: result.lastInsertRowid, message: 'Peserta berhasil ditambahkan' };
  });

  // PUT /api/peserta/:id — edit (Admin only)
  fastify.put('/:id', {
    onRequest: [fastify.authenticate],
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: {
          nama: { type: 'string' },
          nik: { type: 'string' },
          email: { type: 'string' },
          no_telpon: { type: 'string' },
          seat: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Hanya Admin yang bisa edit peserta' });
    }

    const db = getDb();
    const id = Number(request.params.id);
    const peserta = db.prepare('SELECT * FROM peserta WHERE id = ? AND is_active = 1').get(id);
    if (!peserta) return reply.code(404).send({ error: 'Peserta tidak ditemukan' });

    const { nama, nik, email, no_telpon, seat } = request.body;
    const { section, seat_number } = parseSeat(seat || peserta.seat);

    // Check duplicate NIK if changed
    if (nik && nik.trim() !== peserta.nik) {
      const existing = db.prepare('SELECT id FROM peserta WHERE nik = ? AND id != ?').get(nik.trim(), id);
      if (existing) return reply.code(409).send({ error: 'NIK sudah digunakan peserta lain' });
    }

    db.prepare(`
      UPDATE peserta SET
        nama = ?, nik = ?, email = ?, no_telpon = ?,
        seat = ?, section = ?, seat_number = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      nama?.trim() || peserta.nama,
      nik?.trim() || peserta.nik,
      email?.trim() ?? peserta.email,
      no_telpon?.trim() ?? peserta.no_telpon,
      seat?.trim() ?? peserta.seat,
      section ?? peserta.section,
      seat_number ?? peserta.seat_number,
      id
    );

    log({
      userId: request.user.id,
      username: request.user.username,
      action: 'EDIT_PESERTA',
      entity: 'peserta',
      entityId: id,
      detail: request.body,
      ipAddress: request.ip,
    });

    return { message: 'Peserta berhasil diupdate' };
  });

  // DELETE /api/peserta/:id — soft delete (Admin only)
  fastify.delete('/:id', {
    onRequest: [fastify.authenticate],
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Hanya Admin yang bisa menghapus peserta' });
    }

    const db = getDb();
    const id = Number(request.params.id);
    const peserta = db.prepare('SELECT * FROM peserta WHERE id = ? AND is_active = 1').get(id);
    if (!peserta) return reply.code(404).send({ error: 'Peserta tidak ditemukan' });

    db.prepare("UPDATE peserta SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(id);

    log({
      userId: request.user.id,
      username: request.user.username,
      action: 'DELETE_PESERTA',
      entity: 'peserta',
      entityId: id,
      detail: { nama: peserta.nama, nik: peserta.nik },
      ipAddress: request.ip,
    });

    return { message: 'Peserta berhasil dihapus' };
  });

  // POST /api/peserta/upload — upload Excel
  fastify.post('/upload', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Hanya Admin yang bisa upload data' });
    }

    const data = await request.file();
    if (!data) return reply.code(400).send({ error: 'File tidak ditemukan' });

    const ext = path.extname(data.filename).toLowerCase();
    if (!['.xlsx', '.xls'].includes(ext)) {
      return reply.code(400).send({ error: 'File harus berformat .xlsx atau .xls' });
    }

    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();

    // Read from stream
    const chunks = [];
    for await (const chunk of data.file) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    await wb.xlsx.load(buffer);

    const ws = wb.worksheets[0];
    if (!ws) return reply.code(400).send({ error: 'Sheet tidak ditemukan di file Excel' });

    // Read header row to find column indices
    const headerRow = ws.getRow(1).values; // index 1-based
    const colMap = {};
    headerRow.forEach((h, i) => {
      if (!h) return;
      const key = String(h).trim().toUpperCase();
      if (key.includes('NAMA')) colMap.nama = i;
      else if (key.includes('NIK')) colMap.nik = i;
      else if (key.includes('EMAIL')) colMap.email = i;
      else if (key.includes('TELPON') || key.includes('TELP') || key.includes('PHONE')) colMap.no_telpon = i;
      else if (key.includes('SEAT') || key.includes('KURSI')) colMap.seat = i;
    });

    if (!colMap.nama || !colMap.nik) {
      return reply.code(400).send({ error: 'Kolom NAMA LENGKAP dan NO NIK wajib ada di Excel' });
    }

    const db = getDb();
    let inserted = 0;
    let skipped = 0;
    const errors = [];

    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO peserta (nama, nik, email, no_telpon, seat, section, seat_number)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((rows) => {
      for (const row of rows) {
        const result = insertStmt.run(
          row.nama, row.nik, row.email, row.no_telpon, row.seat, row.section, row.seat_number
        );
        if (result.changes > 0) inserted++;
        else skipped++;
      }
    });

    const rowsToInsert = [];
    ws.eachRow((row, rowNum) => {
      if (rowNum === 1) return; // skip header
      const nama = getCellValue(row, colMap.nama);
      const nik = getCellValue(row, colMap.nik);
      if (!nama || !nik) return;

      const seat = colMap.seat ? getCellValue(row, colMap.seat) : null;
      const { section, seat_number } = parseSeat(seat);

      rowsToInsert.push({
        nama: String(nama).trim(),
        nik: String(nik).trim(),
        email: colMap.email ? getCellValue(row, colMap.email) || null : null,
        no_telpon: colMap.no_telpon ? getCellValue(row, colMap.no_telpon) || null : null,
        seat: seat ? String(seat).trim() : null,
        section,
        seat_number,
      });
    });

    insertMany(rowsToInsert);

    log({
      userId: request.user.id,
      username: request.user.username,
      action: 'UPLOAD_EXCEL',
      entity: 'peserta',
      detail: { filename: data.filename, inserted, skipped },
      ipAddress: request.ip,
    });

    return { message: 'Upload berhasil', inserted, skipped, total: rowsToInsert.length };
  });
};

function parseSeat(seat) {
  if (!seat) return { section: null, seat_number: null };
  const parts = String(seat).split(/\s*[-–]\s*/);
  if (parts.length >= 2) {
    return {
      section: parts[0].trim().toUpperCase(),
      seat_number: parts[1].trim(),
    };
  }
  return { section: seat.trim().toUpperCase(), seat_number: null };
}

function getCellValue(row, colIndex) {
  const cell = row.getCell(colIndex);
  if (cell.value === null || cell.value === undefined) return null;
  if (typeof cell.value === 'object' && cell.value.text) return cell.value.text;
  return cell.value;
}

function maskNik(row, role) {
  if (role === 'crew' && row.nik) {
    return { ...row, nik: row.nik.slice(0, 4) + '****' + row.nik.slice(-4) };
  }
  return row;
}
