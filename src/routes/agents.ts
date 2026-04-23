import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Pool } from 'pg';
import { authMiddleware } from '../auth/authMiddleware.js';
import { NotFoundError, ValidationError } from '../errors.js';

const CreateAgentSchema = z.object({ name: z.string().min(1) });
const UpdateAgentSchema = z.object({
  name: z.string().min(1).optional(),
  status: z.enum(['active', 'paused', 'triggered']).optional(),
}).refine((d) => d.name !== undefined || d.status !== undefined, {
  message: 'At least one field required',
});

export async function agentRoutes(fastify: FastifyInstance, opts: { pool: Pool }): Promise<void> {
  const { pool } = opts;
  const auth = authMiddleware(pool);

  // POST /agents
  fastify.post('/agents', { preHandler: auth }, async (request, reply) => {
    const parsed = CreateAgentSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', Object.fromEntries(
        parsed.error.errors.map((e) => [e.path.join('.'), e.message]),
      ));
    }
    const { rows } = await pool.query(
      `INSERT INTO agents (creator_wallet, name) VALUES ($1, $2)
       RETURNING id, creator_wallet AS "creatorWallet", name, status,
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [request.creatorWallet, parsed.data.name],
    );
    return reply.code(201).send(rows[0]);
  });

  // GET /agents
  fastify.get('/agents', { preHandler: auth }, async (request, reply) => {
    const { rows } = await pool.query(
      `SELECT id, creator_wallet AS "creatorWallet", name, status,
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM agents WHERE creator_wallet = $1 ORDER BY created_at DESC`,
      [request.creatorWallet],
    );
    return reply.code(200).send(rows);
  });

  // GET /agents/:id
  fastify.get<{ Params: { id: string } }>('/agents/:id', { preHandler: auth }, async (request, reply) => {
    const { rows } = await pool.query(
      `SELECT id, creator_wallet AS "creatorWallet", name, status,
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM agents WHERE id = $1 AND creator_wallet = $2`,
      [request.params.id, request.creatorWallet],
    );
    if (!rows[0]) throw new NotFoundError('Agent not found');
    return reply.code(200).send(rows[0]);
  });

  // PATCH /agents/:id
  fastify.patch<{ Params: { id: string } }>('/agents/:id', { preHandler: auth }, async (request, reply) => {
    const parsed = UpdateAgentSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', Object.fromEntries(
        parsed.error.errors.map((e) => [e.path.join('.'), e.message]),
      ));
    }

    // Verify ownership
    const existing = await pool.query(
      'SELECT id FROM agents WHERE id = $1 AND creator_wallet = $2',
      [request.params.id, request.creatorWallet],
    );
    if (!existing.rows[0]) throw new NotFoundError('Agent not found');

    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    if (parsed.data.name !== undefined) { updates.push(`name = $${idx++}`); values.push(parsed.data.name); }
    if (parsed.data.status !== undefined) { updates.push(`status = $${idx++}`); values.push(parsed.data.status); }
    updates.push(`updated_at = NOW()`);
    values.push(request.params.id, request.creatorWallet);

    const { rows } = await pool.query(
      `UPDATE agents SET ${updates.join(', ')}
       WHERE id = $${idx++} AND creator_wallet = $${idx}
       RETURNING id, creator_wallet AS "creatorWallet", name, status,
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      values,
    );
    return reply.code(200).send(rows[0]);
  });

  // DELETE /agents/:id
  fastify.delete<{ Params: { id: string } }>('/agents/:id', { preHandler: auth }, async (request, reply) => {
    const result = await pool.query(
      'DELETE FROM agents WHERE id = $1 AND creator_wallet = $2',
      [request.params.id, request.creatorWallet],
    );
    if (result.rowCount === 0) throw new NotFoundError('Agent not found');
    return reply.code(204).send();
  });
}
