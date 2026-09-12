'use strict';

const { getDb } = require('../db/schema');
const { log } = require('../services/audit');

module.exports = async function (fastify) {
  // GET /api/settings — app-level settings only.
  // Project-level (logo, event_name, theme) lives on /api/projects/:id
  fastify.get('/', async () => {
    const db = getDb();
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    return settings;
  });
};
