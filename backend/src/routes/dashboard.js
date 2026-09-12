'use strict';

const { getDb } = require('../db/schema');

module.exports = async function (fastify) {
  // GET /api/dashboard — scoped to project
  fastify.get('/', {
    onRequest: [fastify.authenticate],
  }, async (request) => {
    const db = getDb();
    const projectId = request.projectId;

    const total = db.prepare('SELECT COUNT(*) as cnt FROM peserta WHERE is_active = 1 AND project_id = ?')
      .get(projectId).cnt;

    const registered = db.prepare(`
      SELECT COUNT(*) as cnt FROM peserta p
      WHERE p.is_active = 1 AND p.project_id = ?
        AND (
          SELECT status FROM registrations r
          WHERE r.peserta_id = p.id
          ORDER BY r.created_at DESC LIMIT 1
        ) = 'registered'
    `).get(projectId).cnt;

    const pending = total - registered;

    const bySection = db.prepare(`
      SELECT
        p.section,
        COUNT(*) as total,
        SUM(CASE
          WHEN (
            SELECT status FROM registrations r
            WHERE r.peserta_id = p.id
            ORDER BY r.created_at DESC LIMIT 1
          ) = 'registered' THEN 1 ELSE 0
        END) as registered
      FROM peserta p
      WHERE p.is_active = 1 AND p.project_id = ? AND p.section IS NOT NULL
      GROUP BY p.section
      ORDER BY p.section
    `).all(projectId);

    const recentActivity = db.prepare(`
      SELECT al.*, p.nama as peserta_nama
      FROM audit_log al
      LEFT JOIN peserta p ON p.id = al.entity_id AND al.entity = 'peserta'
      WHERE al.action IN ('CHECKIN', 'UNREGISTER')
        AND (al.project_id = ? OR (al.project_id IS NULL AND p.project_id = ?))
      ORDER BY al.created_at DESC
      LIMIT 100
    `).all(projectId, projectId);

    return {
      total,
      registered,
      pending,
      percentage: total > 0 ? Math.round((registered / total) * 100) : 0,
      by_section: bySection,
      recent_activity: recentActivity,
    };
  });
};
