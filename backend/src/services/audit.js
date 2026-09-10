'use strict';

const { getDb } = require('../db/schema');

function log({ userId, username, action, entity, entityId, detail, ipAddress }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO audit_log (user_id, username, action, entity, entity_id, detail, ip_address)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId || null,
    username || null,
    action,
    entity || null,
    entityId || null,
    detail ? JSON.stringify(detail) : null,
    ipAddress || null
  );
}

function getLogs({ limit = 100, offset = 0, entity, action } = {}) {
  const db = getDb();
  let query = 'SELECT * FROM audit_log WHERE 1=1';
  const params = [];

  if (entity) { query += ' AND entity = ?'; params.push(entity); }
  if (action) { query += ' AND action = ?'; params.push(action); }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  return db.prepare(query).all(...params);
}

module.exports = { log, getLogs };
