'use strict';

const { getDb } = require('../db/schema');
const { log } = require('../services/audit');
const path = require('path');

module.exports = async function (fastify) {
  // GET /api/peserta — universal search (scoped to project)
  fastify.get('/', {
    onRequest: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          section: { type: 'string' },
          status: { type: 'string', enum: ['registered', 'cancelled', 'pending'] },
          batch_id: { type: 'integer' },
          limit: { type: 'integer', default: 50 },
          offset: { type: 'integer', default: 0 },
        },
      },
    },
  }, async (request) => {
    const db = getDb();
    const { q, section, status, batch_id, limit = 50, offset = 0 } = request.query;
    const projectId = request.projectId;

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
      WHERE p.is_active = 1 AND p.project_id = ?
    `;
    const params = [projectId];

    if (q && q.trim()) {
      const term = `%${q.trim()}%`;
      query += ` AND (
        p.nama LIKE ? OR
        p.kode LIKE ? OR
        p.nik LIKE ? OR
        p.email LIKE ? OR
        p.no_telpon LIKE ? OR
        p.seat LIKE ? OR
        p.section LIKE ? OR
        p.extra1 LIKE ? OR p.extra2 LIKE ? OR p.extra3 LIKE ? OR
        p.extra4 LIKE ? OR p.extra5 LIKE ?
      )`;
      params.push(term, term, term, term, term, term, term, term, term, term, term, term);
    }

    if (section) {
      query += ' AND p.section = ?';
      params.push(section);
    }

    if (batch_id) {
      query += ' AND p.upload_batch_id = ?';
      params.push(batch_id);
    }

    if (status === 'registered') {
      query += " AND r.status = 'registered'";
    } else if (status === 'cancelled') {
      query += " AND r.status = 'cancelled'";
    } else if (status === 'pending') {
      query += ' AND r.id IS NULL';
    }

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

  // GET /api/peserta/batches — list upload batches (scoped)
  fastify.get('/batches', {
    onRequest: [fastify.authenticate],
  }, async (request) => {
    if (request.user.role !== 'admin') {
      return { error: 'Akses ditolak' };
    }
    const db = getDb();
    const batches = db.prepare(`
      SELECT
        b.*,
        u.full_name AS uploaded_by_name,
        (SELECT COUNT(*) FROM peserta p WHERE p.upload_batch_id = b.id AND p.is_active = 1) AS active_peserta
      FROM upload_batches b
      LEFT JOIN users u ON u.id = b.uploaded_by
      WHERE b.total_rows > 0 AND b.project_id = ?
      ORDER BY b.uploaded_at DESC
    `).all(request.projectId);
    return batches;
  });

  // DELETE /api/peserta/batches/:id — remove all peserta in a batch (scoped)
  fastify.delete('/batches/:id', {
    onRequest: [fastify.authenticate],
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Hanya Admin yang bisa menghapus batch' });
    }

    const db = getDb();
    const batchId = Number(request.params.id);
    const batch = db.prepare('SELECT * FROM upload_batches WHERE id = ? AND project_id = ?')
      .get(batchId, request.projectId);
    if (!batch) return reply.code(404).send({ error: 'Batch tidak ditemukan' });

    const result = db.prepare(
      "UPDATE peserta SET is_active = 0, updated_at = datetime('now','localtime') WHERE upload_batch_id = ? AND is_active = 1"
    ).run(batchId);

    log({
      userId: request.user.id,
      username: request.user.username,
      action: 'DELETE_BATCH',
      entity: 'upload_batches',
      entityId: batchId,
      projectId: request.projectId,
      detail: { filename: batch.filename, removed: result.changes },
      ipAddress: request.ip,
    });

    return { message: `Batch dihapus — ${result.changes} peserta dinonaktifkan`, removed: result.changes };
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
      WHERE p.id = ? AND p.is_active = 1 AND p.project_id = ?
    `).get(Number(request.params.id), request.projectId);

    if (!row) return reply.code(404).send({ error: 'Peserta tidak ditemukan' });
    return maskNik(row, request.user.role);
  });

  // POST /api/peserta/bulk-update — bulk edit (Admin only, scoped)
  fastify.post('/bulk-update', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['ids'],
        properties: {
          ids: { type: 'array', items: { type: 'integer' }, minItems: 1 },
          updates: {
            type: 'object',
            properties: {
              section: { type: 'string' },
              seat:    { type: 'string' },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Hanya Admin yang bisa bulk edit' });
    }

    const db = getDb();
    const { ids, updates } = request.body;
    const { section, seat } = updates || {};

    if (!section && !seat) {
      return reply.code(400).send({ error: 'Minimal satu field untuk update (section atau seat)' });
    }

    let finalSeat = seat || null;
    let finalSection = section || null;
    let finalSeatNumber = null;
    if (finalSeat) {
      const parsed = parseSeat(finalSeat);
      finalSection = parsed.section;
      finalSeatNumber = parsed.seat_number;
    }

    const updateStmt = db.prepare(`
      UPDATE peserta SET
        seat = COALESCE(?, seat),
        section = COALESCE(?, section),
        seat_number = COALESCE(?, seat_number),
        updated_at = datetime('now','localtime')
      WHERE id = ? AND is_active = 1 AND project_id = ?
    `);

    const runBulk = db.transaction((idList) => {
      let updated = 0;
      for (const id of idList) {
        const res = updateStmt.run(finalSeat, finalSection, finalSeatNumber, id, request.projectId);
        if (res.changes > 0) updated++;
      }
      return updated;
    });

    const updated = runBulk(ids);

    log({
      userId: request.user.id,
      username: request.user.username,
      action: 'BULK_EDIT_PESERTA',
      entity: 'peserta',
      projectId: request.projectId,
      detail: { count: updated, section, seat, ids: ids.slice(0, 50) },
      ipAddress: request.ip,
    });

    return { message: `${updated} peserta berhasil diupdate`, updated };
  });

  // POST /api/peserta/bulk-delete — bulk remove (Admin only, scoped)
  fastify.post('/bulk-delete', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['ids'],
        properties: {
          ids: { type: 'array', items: { type: 'integer' }, minItems: 1 },
        },
      },
    },
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Hanya Admin yang bisa bulk delete' });
    }

    const db = getDb();
    const { ids } = request.body;

    const deleteStmt = db.prepare(
      "UPDATE peserta SET is_active = 0, updated_at = datetime('now','localtime') WHERE id = ? AND is_active = 1 AND project_id = ?"
    );

    const runBulk = db.transaction((idList) => {
      let deleted = 0;
      for (const id of idList) {
        const res = deleteStmt.run(id, request.projectId);
        if (res.changes > 0) deleted++;
      }
      return deleted;
    });

    const deleted = runBulk(ids);

    log({
      userId: request.user.id,
      username: request.user.username,
      action: 'BULK_DELETE_PESERTA',
      entity: 'peserta',
      projectId: request.projectId,
      detail: { count: deleted, ids: ids.slice(0, 50) },
      ipAddress: request.ip,
    });

    return { message: `${deleted} peserta berhasil dihapus`, deleted };
  });

  // POST /api/peserta — add manual (Admin only, scoped)
  fastify.post('/', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['nama'],
        properties: {
          nama: { type: 'string' },
          kode: { type: 'string' },
          nik: { type: 'string' },
          email: { type: 'string' },
          no_telpon: { type: 'string' },
          seat: { type: 'string' },
          extra1: { type: 'string' }, extra2: { type: 'string' }, extra3: { type: 'string' },
          extra4: { type: 'string' }, extra5: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Hanya Admin yang bisa menambah peserta manual' });
    }

    const db = getDb();
    const { nama, kode, nik, email, no_telpon, seat } = request.body;
    const { section, seat_number } = parseSeat(seat);
    const projectId = request.projectId;

    const row = {
      nama: nama.trim(),
      kode: kode?.trim() || null,
      nik: nik?.trim() || null,
      email: email?.trim() || null,
      no_telpon: no_telpon?.trim() || null,
    };

    const uniqueFields = getUniqueFields(db, projectId);

    // Require at least one configured identity value
    if (!uniqueFields.some(f => row[f])) {
      return reply.code(400).send({
        error: `Minimal salah satu patokan unik harus diisi: ${uniqueFields.join(', ')}`,
      });
    }

    // Duplicate check against configured unique fields (active rows only)
    const dup = findDuplicate(db, projectId, row, uniqueFields);
    if (dup) {
      return reply.code(409).send({
        error: `Peserta dengan ${dup.field} yang sama sudah terdaftar di project ini`,
      });
    }

    const ex = (v) => (v === undefined || v === null || String(v).trim() === '') ? null : String(v).trim();

    const result = db.prepare(`
      INSERT INTO peserta (project_id, nama, kode, nik, email, no_telpon, seat, section, seat_number,
                           extra1, extra2, extra3, extra4, extra5)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      projectId,
      row.nama,
      row.kode,
      row.nik,
      row.email,
      row.no_telpon,
      seat?.trim() || null,
      section,
      seat_number,
      ex(request.body.extra1), ex(request.body.extra2), ex(request.body.extra3),
      ex(request.body.extra4), ex(request.body.extra5)
    );

    log({
      userId: request.user.id,
      username: request.user.username,
      action: 'ADD_PESERTA',
      entity: 'peserta',
      entityId: result.lastInsertRowid,
      projectId,
      detail: { nama, kode, nik },
      ipAddress: request.ip,
    });

    return { id: result.lastInsertRowid, message: 'Peserta berhasil ditambahkan' };
  });

  // PUT /api/peserta/:id — edit (Admin only, scoped)
  fastify.put('/:id', {
    onRequest: [fastify.authenticate],
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: {
          nama: { type: 'string' },
          kode: { type: 'string' },
          nik: { type: 'string' },
          email: { type: 'string' },
          no_telpon: { type: 'string' },
          seat: { type: 'string' },
          extra1: { type: 'string' }, extra2: { type: 'string' }, extra3: { type: 'string' },
          extra4: { type: 'string' }, extra5: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Hanya Admin yang bisa edit peserta' });
    }

    const db = getDb();
    const id = Number(request.params.id);
    const projectId = request.projectId;
    const peserta = db.prepare('SELECT * FROM peserta WHERE id = ? AND is_active = 1 AND project_id = ?')
      .get(id, projectId);
    if (!peserta) return reply.code(404).send({ error: 'Peserta tidak ditemukan' });

    const { nama, kode, nik, email, no_telpon, seat } = request.body;
    const { section, seat_number } = parseSeat(seat || peserta.seat);

    const row = {
      nama: nama?.trim() || peserta.nama,
      kode: kode === undefined ? peserta.kode : (kode?.trim() || null),
      nik: nik === undefined ? peserta.nik : (nik?.trim() || null),
      email: email === undefined ? peserta.email : (email?.trim() || null),
      no_telpon: no_telpon === undefined ? peserta.no_telpon : (no_telpon?.trim() || null),
    };

    const uniqueFields = getUniqueFields(db, projectId);
    if (!uniqueFields.some(f => row[f])) {
      return reply.code(400).send({
        error: `Minimal salah satu patokan unik harus diisi: ${uniqueFields.join(', ')}`,
      });
    }

    // Duplicate check excluding self
    const dup = findDuplicate(db, projectId, row, uniqueFields, id);
    if (dup) {
      return reply.code(409).send({
        error: `Peserta dengan ${dup.field} yang sama sudah terdaftar di project ini`,
      });
    }

    const exv = (v, fallback) => (v === undefined ? fallback : (v === null || String(v).trim() === '' ? null : String(v).trim()));

    db.prepare(`
      UPDATE peserta SET
        nama = ?, kode = ?, nik = ?, email = ?, no_telpon = ?,
        seat = ?, section = ?, seat_number = ?,
        extra1 = ?, extra2 = ?, extra3 = ?, extra4 = ?, extra5 = ?,
        updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(
      row.nama, row.kode, row.nik, row.email, row.no_telpon,
      seat?.trim() ?? peserta.seat,
      section ?? peserta.section,
      seat_number ?? peserta.seat_number,
      exv(request.body.extra1, peserta.extra1), exv(request.body.extra2, peserta.extra2),
      exv(request.body.extra3, peserta.extra3), exv(request.body.extra4, peserta.extra4),
      exv(request.body.extra5, peserta.extra5),
      id
    );

    log({
      userId: request.user.id,
      username: request.user.username,
      action: 'EDIT_PESERTA',
      entity: 'peserta',
      entityId: id,
      projectId,
      detail: request.body,
      ipAddress: request.ip,
    });

    return { message: 'Peserta berhasil diupdate' };
  });

  // DELETE /api/peserta/:id — soft delete (Admin only, scoped)
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
    const peserta = db.prepare('SELECT * FROM peserta WHERE id = ? AND is_active = 1 AND project_id = ?')
      .get(id, request.projectId);
    if (!peserta) return reply.code(404).send({ error: 'Peserta tidak ditemukan' });

    db.prepare("UPDATE peserta SET is_active = 0, updated_at = datetime('now','localtime') WHERE id = ?").run(id);

    log({
      userId: request.user.id,
      username: request.user.username,
      action: 'DELETE_PESERTA',
      entity: 'peserta',
      entityId: id,
      projectId: request.projectId,
      detail: { nama: peserta.nama, nik: peserta.nik },
      ipAddress: request.ip,
    });

    return { message: 'Peserta berhasil dihapus' };
  });

  // POST /api/peserta/upload/preview — parse file, return headers + samples + auto-mapping (no writes)
  fastify.post('/upload/preview', {
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
    const chunks = [];
    for await (const chunk of data.file) chunks.push(chunk);
    await wb.xlsx.load(Buffer.concat(chunks));

    const ws = wb.worksheets[0];
    if (!ws) return reply.code(400).send({ error: 'Sheet tidak ditemukan di file Excel' });

    // Read headers
    const headers = [];
    ws.getRow(1).eachCell((cell, colNumber) => {
      if (cell.value !== null && cell.value !== undefined) {
        headers.push({ index: colNumber, name: String(cell.value).trim() });
      }
    });
    if (headers.length === 0) {
      return reply.code(400).send({ error: 'Baris header tidak ditemukan di baris pertama Excel' });
    }

    // Auto-map by keyword
    const autoMapping = {};
    // First match wins — avoids a later weak match (e.g. "KATEGORI TIKET"
    // containing "TIKET") overwriting a strong earlier match ("KODE BOOKING").
    const setIfEmpty = (field, idx) => {
      if (autoMapping[field] === undefined) autoMapping[field] = idx;
    };
    headers.forEach(h => {
      const key = h.name.toUpperCase();
      if (key.includes('NAMA')) setIfEmpty('nama', h.index);
      else if (key.includes('KODE') || key.includes('BOOKING') || key.includes('BKG') ||
               key.includes('ORDER') || key.includes('INVOICE')) setIfEmpty('kode', h.index);
      else if (key.includes('TIKET') || key.includes('TICKET')) setIfEmpty('kode', h.index);
      else if (key.includes('NIK')) setIfEmpty('nik', h.index);
      else if (key.includes('EMAIL')) setIfEmpty('email', h.index);
      else if (key.includes('TELPON') || key.includes('TELP') || key.includes('PHONE') ||
               key.includes('WHATSAPP') || key.includes('WA')) setIfEmpty('no_telpon', h.index);
      else if (key.includes('SEAT') || key.includes('KURSI')) setIfEmpty('seat', h.index);
    });

    // Sample rows (up to 5)
    const samples = [];
    let count = 0;
    ws.eachRow((row, rowNum) => {
      if (rowNum === 1 || count >= 5) return;
      const sampleRow = [];
      headers.forEach(h => {
        sampleRow.push(cellToString(row.getCell(h.index).value));
      });
      samples.push(sampleRow);
      count++;
    });

    // Load saved mapping for this project (takes precedence over auto)
    const db = getDb();
    const saved = db.prepare('SELECT field, source_column, source_label FROM upload_mappings WHERE project_id = ?')
      .all(request.projectId);
    const savedMapping = {};
    saved.forEach(m => { savedMapping[m.field] = m.source_column ? Number(m.source_column) : null; });

    // Merged mapping: saved > auto
    const merged = { ...autoMapping, ...savedMapping };

    // Total data rows
    let totalRows = 0;
    ws.eachRow((row, rowNum) => { if (rowNum > 1) totalRows++; });

    // Existing extra-slot labels for this project (header names chosen previously)
    const project = db.prepare('SELECT extra_labels FROM projects WHERE id = ?').get(request.projectId);
    let extraLabels = {};
    try { extraLabels = JSON.parse(project?.extra_labels || '{}'); } catch { /* ignore */ }

    return {
      filename: data.filename,
      headers,
      samples,
      mapping: merged,
      extra_labels: extraLabels,
      saved_mapping_exists: saved.length > 0,
      total_rows: totalRows,
    };
  });

  // POST /api/peserta/upload — import with explicit mapping (scoped)
  fastify.post('/upload', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Hanya Admin yang bisa upload data' });
    }

    // Parse multipart parts: file + optional mapping fields
    let fileBuffer = null
    let filename = null
    const fields = {}
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        filename = part.filename
        const chunks = []
        for await (const chunk of part.file) chunks.push(chunk)
        fileBuffer = Buffer.concat(chunks)
      } else {
        fields[part.fieldname] = part.value
      }
    }

    if (!fileBuffer) return reply.code(400).send({ error: 'File tidak ditemukan' })

    const ext = path.extname(filename || '').toLowerCase();
    if (!['.xlsx', '.xls'].includes(ext)) {
      return reply.code(400).send({ error: 'File harus berformat .xlsx atau .xls' });
    }

    // Mapping passed as JSON string in a form field 'mapping'
    let mapping = {};
    const EXTRA_SLOTS = ['extra1', 'extra2', 'extra3', 'extra4', 'extra5'];
    try {
      const raw = fields.mapping;
      if (raw) {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const ALLOWED = ['nama', 'kode', 'nik', 'email', 'no_telpon', 'seat', ...EXTRA_SLOTS];
        ALLOWED.forEach(f => {
          const v = parsed[f];
          if (v === null) { mapping[f] = null; }
          else if (v !== undefined && Number.isInteger(Number(v)) && Number(v) > 0) {
            mapping[f] = Number(v);
          }
        });
      }
    } catch { return reply.code(400).send({ error: 'Format mapping tidak valid' }); }

    // Labels for extra slots = the Excel header names the user mapped (per project)
    let extraLabels = {};
    try {
      const rawLabels = fields.extra_labels;
      if (rawLabels) {
        const parsed = typeof rawLabels === 'string' ? JSON.parse(rawLabels) : rawLabels;
        EXTRA_SLOTS.forEach(slot => {
          const lbl = parsed?.[slot];
          if (typeof lbl === 'string' && lbl.trim()) extraLabels[slot] = lbl.trim();
        });
      }
    } catch { /* labels are optional */ }

    if (!mapping.nama) {
      return reply.code(400).send({ error: 'Kolom untuk Nama wajib dipetakan' });
    }

    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(fileBuffer);

    const ws = wb.worksheets[0];
    if (!ws) return reply.code(400).send({ error: 'Sheet tidak ditemukan di file Excel' });

    const db = getDb();
    const projectId = request.projectId;

    // Unique fields: explicit from this import, else project config, else nik
    let uniqueFields = getUniqueFields(db, projectId);
    try {
      const raw = fields.unique_fields;
      if (raw) {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const valid = Array.isArray(parsed)
          ? parsed.filter(f => ['kode', 'nik', 'email', 'no_telpon'].includes(f))
          : [];
        if (valid.length > 0) uniqueFields = [...new Set(valid)];
      }
    } catch { /* keep project default */ }

    let inserted = 0;
    let skipped = 0;
    const rowsToInsert = [];

    ws.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      const nama = mapping.nama ? getCellValue(row, mapping.nama) : null;
      if (!nama) return;

      const kode = mapping.kode ? getCellValue(row, mapping.kode) : null;
      const nik = mapping.nik ? getCellValue(row, mapping.nik) : null;
      const email = mapping.email ? getCellValue(row, mapping.email) : null;
      const noTelpon = mapping.no_telpon ? getCellValue(row, mapping.no_telpon) : null;
      const seat = mapping.seat ? getCellValue(row, mapping.seat) : null;
      const { section, seat_number } = parseSeat(seat);

      const rowObj = {
        nama: String(nama).trim(),
        kode: kode ? String(kode).trim() : null,
        nik: nik ? String(nik).trim() : null,
        email: email ? String(email).trim() : null,
        no_telpon: noTelpon ? String(noTelpon).trim() : null,
        seat: seat ? String(seat).trim() : null,
        section,
        seat_number,
      };

      // Custom extra columns (labels follow the uploaded headers)
      for (const slot of EXTRA_SLOTS) {
        if (mapping[slot]) {
          const v = getCellValue(row, mapping[slot]);
          rowObj[slot] = v !== null && v !== undefined && String(v).trim() !== ''
            ? String(v).trim()
            : null;
        } else {
          rowObj[slot] = null;
        }
      }

      // Require at least one identity value that is configured as unique
      const hasIdentity = uniqueFields.some(f => rowObj[f]);
      if (!hasIdentity) return; // unusable row — no identity data

      rowsToInsert.push(rowObj);
    });

    if (rowsToInsert.length === 0) {
      return reply.code(400).send({ error: 'Tidak ada baris valid. Pastikan kolom Nama dan kolom patokan unik terisi.' });
    }

    // Build a lookup of existing participants keyed by the configured unique fields.
    // Identity key = JSON of the unique-field values (normalized, lowercased for text).
    const identityKey = (row) => JSON.stringify(
      uniqueFields.map(f => {
        const v = row[f];
        if (v === null || v === undefined || v === '') return null;
        return String(v).trim().toLowerCase();
      })
    );

    const existingByKey = new Map();
    const allRows = db.prepare(
      `SELECT id, is_active, ${uniqueFields.join(', ')} FROM peserta WHERE project_id = ?`
    ).all(projectId);
    for (const r of allRows) {
      const key = identityKey(r);
      // Prefer active row as the canonical match
      if (!existingByKey.has(key) || r.is_active === 1) existingByKey.set(key, r);
    }

    const newRows = [];
    const reactivations = [];
    for (const row of rowsToInsert) {
      const key = identityKey(row);
      const existing = existingByKey.get(key);

      if (existing && existing.is_active === 1) { skipped++; continue; }
      if (existing && existing.is_active === 0) {
        reactivations.push({ existingId: existing.id, row });
      } else {
        newRows.push(row);
      }
      existingByKey.set(key, { id: null, is_active: 1, ...row });
    }

    const insertStmt = db.prepare(`
      INSERT INTO peserta (project_id, nama, kode, nik, email, no_telpon, seat, section, seat_number,
                           extra1, extra2, extra3, extra4, extra5, upload_batch_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const reactivateStmt = db.prepare(`
      UPDATE peserta SET
        nama = ?, kode = ?, nik = ?, email = ?, no_telpon = ?, seat = ?, section = ?, seat_number = ?,
        extra1 = ?, extra2 = ?, extra3 = ?, extra4 = ?, extra5 = ?,
        upload_batch_id = ?, is_active = 1, updated_at = datetime('now','localtime')
      WHERE id = ?
    `);
    const createBatchStmt = db.prepare(`
      INSERT INTO upload_batches (project_id, filename, uploaded_by, total_rows, inserted, skipped)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const upsertMappingStmt = db.prepare(`
      INSERT INTO upload_mappings (project_id, field, source_column, source_label, updated_at)
      VALUES (?, ?, ?, ?, datetime('now','localtime'))
      ON CONFLICT(project_id, field) DO UPDATE SET
        source_column = excluded.source_column,
        source_label = excluded.source_label,
        updated_at = excluded.updated_at
    `);

    let reactivated = 0;
    let batchId = null;
    const insertMany = db.transaction((rows, reacts) => {
      batchId = createBatchStmt.run(
        projectId, filename, request.user.id, rowsToInsert.length, 0, 0
      ).lastInsertRowid;

      for (const row of rows) {
        const result = insertStmt.run(
          projectId, row.nama, row.kode, row.nik, row.email, row.no_telpon, row.seat, row.section, row.seat_number,
          row.extra1, row.extra2, row.extra3, row.extra4, row.extra5,
          batchId
        );
        if (result.changes > 0) inserted++;
      }
      for (const { existingId, row } of reacts) {
        const result = reactivateStmt.run(
          row.nama, row.kode, row.nik, row.email, row.no_telpon, row.seat, row.section, row.seat_number,
          row.extra1, row.extra2, row.extra3, row.extra4, row.extra5,
          batchId, existingId
        );
        if (result.changes > 0) { inserted++; reactivated++; }
      }

      db.prepare('UPDATE upload_batches SET inserted = ?, skipped = ? WHERE id = ?')
        .run(inserted, skipped, batchId);

      // Save mapping template (incl. header labels for extra slots)
      for (const [field, col] of Object.entries(mapping)) {
        upsertMappingStmt.run(projectId, field, col === null ? '' : String(col), extraLabels[field] || null);
      }

      // Persist extra-slot labels on the project (merged with existing)
      const proj = db.prepare('SELECT extra_labels FROM projects WHERE id = ?').get(projectId);
      let merged = {};
      try { merged = JSON.parse(proj?.extra_labels || '{}'); } catch { /* ignore */ }
      Object.assign(merged, extraLabels);
      db.prepare("UPDATE projects SET extra_labels = ?, updated_at = datetime('now','localtime') WHERE id = ?")
        .run(JSON.stringify(merged), projectId);

      // Persist chosen unique fields as the project default
      db.prepare("UPDATE projects SET unique_fields = ?, updated_at = datetime('now','localtime') WHERE id = ?")
        .run(JSON.stringify(uniqueFields), projectId);
    });

    insertMany(newRows, reactivations);

    log({
      userId: request.user.id,
      username: request.user.username,
      action: 'UPLOAD_EXCEL',
      entity: 'peserta',
      entityId: batchId,
      projectId,
      detail: { filename, batch_id: batchId, inserted, reactivated, skipped, total: rowsToInsert.length, mapping },
      ipAddress: request.ip,
    });

    return {
      message: 'Upload berhasil',
      batch_id: batchId,
      inserted,
      reactivated,
      skipped,
      total: rowsToInsert.length,
    };
  });
};

/**
 * Which fields identify a unique participant for this project.
 * Stored as JSON array on projects.unique_fields. Falls back to ['nik'].
 */
function getUniqueFields(db, projectId) {
  const ALLOWED = ['kode', 'nik', 'email', 'no_telpon'];
  try {
    const project = db.prepare('SELECT unique_fields FROM projects WHERE id = ?').get(projectId);
    const parsed = JSON.parse(project?.unique_fields || '[]');
    const valid = Array.isArray(parsed) ? parsed.filter(f => ALLOWED.includes(f)) : [];
    return valid.length > 0 ? valid : ['nik'];
  } catch {
    return ['nik'];
  }
}

/**
 * Find an existing ACTIVE peserta in this project that collides on any
 * configured unique field. Returns { field, id } or null.
 */
function findDuplicate(db, projectId, row, uniqueFields, excludeId = null) {
  for (const field of uniqueFields) {
    const value = row[field];
    if (!value) continue;
    const sql = `SELECT id FROM peserta
                 WHERE project_id = ? AND is_active = 1 AND LOWER(${field}) = LOWER(?)
                 ${excludeId ? 'AND id != ?' : ''}
                 LIMIT 1`;
    const params = excludeId ? [projectId, value, excludeId] : [projectId, value];
    const found = db.prepare(sql).get(...params);
    if (found) return { field, id: found.id };
  }
  return null;
}

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

function cellToString(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && value.text) return String(value.text);
  if (typeof value === 'object' && value.result !== undefined) return String(value.result);
  return String(value);
}

function maskNik(row, role) {
  if (role === 'crew' && row.nik) {
    return { ...row, nik: row.nik.slice(0, 4) + '****' + row.nik.slice(-4) };
  }
  return row;
}
