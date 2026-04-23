import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { authMiddleware } from '../auth/authMiddleware.js';

export async function transactionRoutes(fastify: FastifyInstance, opts: { pool: Pool }): Promise<void> {
  const { pool } = opts;
  const auth = authMiddleware(pool);

  // GET /transactions
  fastify.get('/transactions', { preHandler: auth }, async (request, reply) => {
    const query = request.query as Record<string, string>;
    const page = Math.max(1, parseInt(query['page'] ?? '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(query['pageSize'] ?? '25', 10)));
    const agentId = query['agentId'];
    const offset = (page - 1) * pageSize;

    const conditions: string[] = [
      `a.creator_wallet = $1`,
    ];
    const values: unknown[] = [request.creatorWallet];
    let idx = 2;

    if (agentId) {
      conditions.push(`t.agent_id = $${idx++}`);
      values.push(agentId);
    }

    const where = conditions.join(' AND ');

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM transactions t
       JOIN agents a ON a.id = t.agent_id
       WHERE ${where}`,
      values,
    );
    const total = parseInt(countResult.rows[0].total, 10);

    values.push(pageSize, offset);
    const { rows } = await pool.query(
      `SELECT t.id, t.agent_id AS "agentId", t.rule_id AS "ruleId",
              t.action_type AS "actionType", t.amount_sol AS "amountSOL",
              t.tx_hash AS "txHash", t.executed_at AS "executedAt"
       FROM transactions t
       JOIN agents a ON a.id = t.agent_id
       WHERE ${where}
       ORDER BY t.executed_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      values,
    );

    return reply.code(200).send({
      data: rows,
      pagination: { page, pageSize, total },
    });
  });

  // 405 for mutating methods
  const handler405 = async (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) =>
    reply.code(405).send({ error: 'METHOD_NOT_ALLOWED', message: 'Transactions are append-only' });

  fastify.put('/transactions', handler405 as never);
  fastify.patch('/transactions', handler405 as never);
  fastify.delete('/transactions', handler405 as never);
}
