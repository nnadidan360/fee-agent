import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { BAGSClient } from '../bags/BAGSClient.js';
import { authMiddleware } from '../auth/authMiddleware.js';
import { BAGSApiError } from '../errors.js';

type Range = '7d' | '30d' | '90d';
const VALID_RANGES: Range[] = ['7d', '30d', '90d'];

// Simple in-memory cache: key = `${wallet}:${range}`, value = { data, summary, expiresAt }
const cache = new Map<string, { data: unknown; summary: unknown; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

export async function earningsRoutes(
  fastify: FastifyInstance,
  opts: { pool: Pool; bagsClient: BAGSClient },
): Promise<void> {
  const { pool, bagsClient } = opts;
  const auth = authMiddleware(pool);

  fastify.get('/earnings', { preHandler: auth }, async (request, reply) => {
    const query = request.query as Record<string, string>;
    const range: Range = VALID_RANGES.includes(query['range'] as Range)
      ? (query['range'] as Range)
      : '30d';

    const cacheKey = `${request.creatorWallet}:${range}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return reply.code(200).send({ data: cached.data, summary: cached.summary });
    }

    try {
      const fees = await bagsClient.getFeesGenerated(request.creatorWallet, { range });
      const totalAmountSOL = fees.reduce((sum, f) => sum + f.amountSOL, 0);
      const summary = { totalAmountSOL, range };

      cache.set(cacheKey, { data: fees, summary, expiresAt: Date.now() + CACHE_TTL_MS });

      return reply.code(200).send({ data: fees, summary });
    } catch (err) {
      if (err instanceof BAGSApiError) {
        return reply.code(502).send({
          error: 'UPSTREAM_ERROR',
          message: 'Failed to fetch earnings from BAGS API',
        });
      }
      throw err;
    }
  });
}
