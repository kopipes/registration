'use strict';

const { getDb } = require('../db/schema');
const ExcelJS = require('exceljs');

module.exports = async function (fastify) {
  // GET /api/export/peserta — export all peserta with registration status
  fastify.get('/peserta', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    if (request.user.role === 'crew') {
      return reply.code(403).send({ error: 'Crew tidak bisa export laporan' });
    }

    const db = getDb();
    const rows = db.prepare(`
      SELECT
        p.nama, p.nik, p.email, p.no_telpon, p.seat, p.section, p.seat_number,
        COALESCE((
          SELECT status FROM registrations r
          WHERE r.peserta_id = p.id
          ORDER BY r.created_at DESC LIMIT 1
        ), 'pending') AS status,
        (
          SELECT registered_at FROM registrations r
          WHERE r.peserta_id = p.id AND r.status = 'registered'
          ORDER BY r.created_at DESC LIMIT 1
        ) AS registered_at,
        (
          SELECT u.full_name FROM registrations r
          JOIN users u ON u.id = r.registered_by
          WHERE r.peserta_id = p.id AND r.status = 'registered'
          ORDER BY r.created_at DESC LIMIT 1
        ) AS registered_by_name
      FROM peserta p
      WHERE p.is_active = 1 AND p.project_id = ?
      ORDER BY p.section ASC, p.seat_number ASC, p.nama ASC
    `).all(request.projectId);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Event Check-in System';
    const ws = wb.addWorksheet('Laporan Registrasi');

    ws.columns = [
      { header: 'NAMA LENGKAP', key: 'nama', width: 30 },
      { header: 'NO NIK', key: 'nik', width: 20 },
      { header: 'EMAIL', key: 'email', width: 30 },
      { header: 'NO TELPON', key: 'no_telpon', width: 16 },
      { header: 'SECTION', key: 'section', width: 12 },
      { header: 'SEAT', key: 'seat', width: 16 },
      { header: 'STATUS', key: 'status', width: 12 },
      { header: 'WAKTU CHECK-IN', key: 'registered_at', width: 20 },
      { header: 'DICEK-IN OLEH', key: 'registered_by_name', width: 20 },
    ];

    // Style header row
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = {
      type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' },
    };
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    rows.forEach(row => {
      const r = ws.addRow(row);
      if (row.status === 'registered') {
        r.getCell('status').fill = {
          type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD4EDDA' },
        };
      } else if (row.status === 'pending') {
        r.getCell('status').fill = {
          type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' },
        };
      }
    });

    // Summary rows
    ws.addRow([]);
    const registered = rows.filter(r => r.status === 'registered').length;
    ws.addRow(['Total Peserta', rows.length]);
    ws.addRow(['Sudah Check-in', registered]);
    ws.addRow(['Belum Check-in', rows.length - registered]);

    const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="laporan-registrasi-${timestamp}.xlsx"`);

    const buffer = await wb.xlsx.writeBuffer();
    return reply.send(buffer);
  });

  // GET /api/export/log — export audit log
  fastify.get('/log', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Hanya Admin yang bisa export log' });
    }

    const db = getDb();
    const rows = db.prepare(
      'SELECT * FROM audit_log WHERE project_id = ? OR project_id IS NULL ORDER BY created_at DESC LIMIT 5000'
    ).all(request.projectId);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Audit Log');
    ws.columns = [
      { header: 'ID', key: 'id', width: 8 },
      { header: 'USERNAME', key: 'username', width: 16 },
      { header: 'ACTION', key: 'action', width: 20 },
      { header: 'ENTITY', key: 'entity', width: 12 },
      { header: 'ENTITY ID', key: 'entity_id', width: 10 },
      { header: 'DETAIL', key: 'detail', width: 40 },
      { header: 'IP', key: 'ip_address', width: 16 },
      { header: 'WAKTU', key: 'created_at', width: 22 },
    ];
    ws.getRow(1).font = { bold: true };
    rows.forEach(r => ws.addRow(r));

    const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="audit-log-${timestamp}.xlsx"`);

    const buffer = await wb.xlsx.writeBuffer();
    return reply.send(buffer);
  });
};
