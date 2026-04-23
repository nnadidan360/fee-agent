import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Pool } from 'pg';
import { generateChallenge, verifySignature, logout } from '../auth/authService.js';
import { authMiddleware } from '../auth/authMiddleware.js';
import { ValidationError } from '../errors.js';

const ChallengeBodySchema = z.object({
  walletAddress: z.string().min(1),
});

const VerifyBodySchema = z.object({
  walletAddress: z.string().min(1),
  nonce: z.string().min(1),
  signature: z.string().min(1),
});

export async function authRoutes(fastify: FastifyInstance, opts: { pool: Pool }): Promise<void> {
  const { pool } = opts;

  // POST /auth/challenge
  fastify.post('/auth/challenge', async (request, reply) => {
    const parsed = ChallengeBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', Object.fromEntries(
        parsed.error.errors.map((e) => [e.path.join('.'), e.message]),
      ));
    }
    const result = await generateChallenge(pool, parsed.data.walletAddress);
    return reply.code(200).send(result);
  });

  // POST /auth/verify
  fastify.post('/auth/verify', async (request, reply) => {
    const parsed = VerifyBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', Object.fromEntries(
        parsed.error.errors.map((e) => [e.path.join('.'), e.message]),
      ));
    }
    const { walletAddress, nonce, signature } = parsed.data;
    const result = await verifySignature(pool, walletAddress, nonce, signature);
    return reply.code(200).send(result);
  });

  // POST /auth/logout (protected)
  fastify.post('/auth/logout', { preHandler: authMiddleware(pool) }, async (request, reply) => {
    const { jti, exp } = request.jwtPayload;
    await logout(pool, jti, exp);
    return reply.code(204).send();
  });
}
