'use strict';

const { searchLogs, getActions, getUsernames } = require('../services/audit');

module.exports = async function (fastify) {
  // GET /api/audit — paged audit log viewer (Admin only)
  fastify.get('/', {
    onRequest: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          action: { type: 'string' },
          username: { type: 'string' },
          project_id: { type: 'integer' },
          from: { type: 'string' },
          to: { type: 'string' },
          limit: { type: 'integer', default: 50 },
          offset: { type: 'integer', default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Hanya Admin yang bisa melihat audit log' });
    }
    const { q, action, username, project_id, from, to, limit = 50, offset = 0 } = request.query;
    return searchLogs({ q, action, username, projectId: project_id, from, to, limit, offset });
  });

  // GET /api/audit/filters — dropdown values (Admin only)
  fastify.get('/filters', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Hanya Admin yang bisa melihat audit log' });
    }
    return { actions: getActions(), usernames: getUsernames() };
  });
};
