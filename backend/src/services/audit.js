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

function getLogs({ limit = 100, offset = 0, entity, action, projectId } = {}) {
  const db = getDb();
  let query = 'SELECT * FROM audit_log WHERE 1=1';
  const params = [];

  if (entity) { query += ' AND entity = ?'; params.push(entity); }
  if (action) { query += ' AND action = ?'; params.push(action); }
  if (projectId) { query += ' AND project_id = ?'; params.push(projectId); }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  return db.prepare(query).all(...params);
}

/**
 * Paged audit log search for the in-app viewer.
 */
function searchLogs({ q, action, username, projectId, from, to, limit = 50, offset = 0 } = {}) {
  const db = getDb();
  let where = ' WHERE 1=1';
  const params = [];

  if (q && q.trim()) {
    const term = `%${q.trim()}%`;
    where += ' AND (detail LIKE ? OR entity LIKE ? OR username LIKE ?)';
    params.push(term, term, term);
  }
  if (action) { where += ' AND action = ?'; params.push(action); }
  if (username) { where += ' AND username = ?'; params.push(username); }
  if (projectId) { where += ' AND project_id = ?'; params.push(projectId); }
  if (from) { where += ' AND created_at >= ?'; params.push(from); }
  if (to) { where += ' AND created_at <= ?'; params.push(to); }

  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM audit_log${where}`).get(...params);
  const rows = db.prepare(
    `SELECT * FROM audit_log${where} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  return { total, limit, offset, data: rows };
}

/** Distinct action names — for the filter dropdown. */
function getActions() {
  const db = getDb();
  return db.prepare('SELECT DISTINCT action FROM audit_log ORDER BY action').all().map(r => r.action);
}

/** Distinct usernames that appear in the log. */
function getUsernames() {
  const db = getDb();
  return db.prepare(
    "SELECT DISTINCT username FROM audit_log WHERE username IS NOT NULL AND username != '' ORDER BY username"
  ).all().map(r => r.username);
}

module.exports = { log, getLogs, searchLogs, getActions, getUsernames };
