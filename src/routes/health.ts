import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

const startTime = Date.now();

export async function healthRoutes(fastify: FastifyInstance, opts: { pool: Pool }): Promise<void> {
  const { pool } = opts;

  fastify.get('/health', async (_request, reply) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const timestamp = new Date().toISOString();

    try {
      await pool.query('SELECT 1');
      return reply.code(200).send({ status: 'ok', uptime, timestamp });
    } catch {
      return reply.code(503).send({ status: 'degraded', message: 'Database unreachable', uptime, timestamp });
    }
  });
}
