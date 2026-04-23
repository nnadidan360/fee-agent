import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { authMiddleware } from '../auth/authMiddleware.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { CreateRuleBodySchema, UpdateRuleBodySchema, validateSplitConfig } from '../rules/validation.js';

export async function ruleRoutes(fastify: FastifyInstance, opts: { pool: Pool }): Promise<void> {
  const { pool } = opts;
  const auth = authMiddleware(pool);

  async function assertAgentOwnership(agentId: string, creatorWallet: string): Promise<void> {
    const { rows } = await pool.query(
      'SELECT id FROM agents WHERE id = $1 AND creator_wallet = $2',
      [agentId, creatorWallet],
    );
    if (!rows[0]) throw new NotFoundError('Agent not found');
  }

  // POST /agents/:agentId/rules
  fastify.post<{ Params: { agentId: string } }>(
    '/agents/:agentId/rules',
    { preHandler: auth },
    async (request, reply) => {
      await assertAgentOwnership(request.params.agentId, request.creatorWallet);

      const parsed = CreateRuleBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError('Validation failed', Object.fromEntries(
          parsed.error.errors.map((e) => [e.path.join('.'), e.message]),
        ));
      }

      const { conditionType, conditionValue, actionType, actionConfig } = parsed.data;

      if (actionType === 'split') {
        const v = validateSplitConfig(actionConfig);
        if (!v.success) {
          throw new ValidationError('Split percentages must sum to 100', {
            'actionConfig.recipients': v.error,
          });
        }
      }

      const { rows } = await pool.query(
        `INSERT INTO rules (agent_id, condition_type, condition_value, action_type, action_config)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, agent_id AS "agentId", condition_type AS "conditionType",
                   condition_value AS "conditionValue", action_type AS "actionType",
                   action_config AS "actionConfig", created_at AS "createdAt"`,
        [request.params.agentId, conditionType, conditionValue, actionType, JSON.stringify(actionConfig)],
      );
      return reply.code(201).send(rows[0]);
    },
  );

  // GET /agents/:agentId/rules
  fastify.get<{ Params: { agentId: string } }>(
    '/agents/:agentId/rules',
    { preHandler: auth },
    async (request, reply) => {
      await assertAgentOwnership(request.params.agentId, request.creatorWallet);
      const { rows } = await pool.query(
        `SELECT id, agent_id AS "agentId", condition_type AS "conditionType",
                condition_value AS "conditionValue", action_type AS "actionType",
                action_config AS "actionConfig", created_at AS "createdAt"
         FROM rules WHERE agent_id = $1 ORDER BY created_at ASC`,
        [request.params.agentId],
      );
      return reply.code(200).send(rows);
    },
  );

  // PATCH /agents/:agentId/rules/:ruleId
  fastify.patch<{ Params: { agentId: string; ruleId: string } }>(
    '/agents/:agentId/rules/:ruleId',
    { preHandler: auth },
    async (request, reply) => {
      await assertAgentOwnership(request.params.agentId, request.creatorWallet);

      const parsed = UpdateRuleBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError('Validation failed', Object.fromEntries(
          parsed.error.errors.map((e) => [e.path.join('.'), e.message]),
        ));
      }

      const { conditionType, conditionValue, actionType, actionConfig } = parsed.data;

      if (actionType === 'split' && actionConfig) {
        const v = validateSplitConfig(actionConfig);
        if (!v.success) {
          throw new ValidationError('Split percentages must sum to 100', {
            'actionConfig.recipients': v.error,
          });
        }
      }

      const updates: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (conditionType !== undefined) { updates.push(`condition_type = $${idx++}`); values.push(conditionType); }
      if (conditionValue !== undefined) { updates.push(`condition_value = $${idx++}`); values.push(conditionValue); }
      if (actionType !== undefined) { updates.push(`action_type = $${idx++}`); values.push(actionType); }
      if (actionConfig !== undefined) { updates.push(`action_config = $${idx++}`); values.push(JSON.stringify(actionConfig)); }

      if (updates.length === 0) throw new ValidationError('No fields to update');

      values.push(request.params.ruleId, request.params.agentId);

      const { rows } = await pool.query(
        `UPDATE rules SET ${updates.join(', ')}
         WHERE id = $${idx++} AND agent_id = $${idx}
         RETURNING id, agent_id AS "agentId", condition_type AS "conditionType",
                   condition_value AS "conditionValue", action_type AS "actionType",
                   action_config AS "actionConfig", created_at AS "createdAt"`,
        values,
      );
      if (!rows[0]) throw new NotFoundError('Rule not found');
      return reply.code(200).send(rows[0]);
    },
  );

  // DELETE /agents/:agentId/rules/:ruleId
  fastify.delete<{ Params: { agentId: string; ruleId: string } }>(
    '/agents/:agentId/rules/:ruleId',
    { preHandler: auth },
    async (request, reply) => {
      await assertAgentOwnership(request.params.agentId, request.creatorWallet);
      const result = await pool.query(
        'DELETE FROM rules WHERE id = $1 AND agent_id = $2',
        [request.params.ruleId, request.params.agentId],
      );
      if (result.rowCount === 0) throw new NotFoundError('Rule not found');
      return reply.code(204).send();
    },
  );
}
