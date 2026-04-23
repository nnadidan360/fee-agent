import Fastify from 'fastify';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import type { Pool } from 'pg';
import type { BAGSClient } from './bags/BAGSClient.js';
import type { EventBroadcaster } from './sse/EventBroadcaster.js';
import { AuthError, NotFoundError, ValidationError, BAGSApiError } from './errors.js';
import { authRoutes } from './routes/auth.js';
import { agentRoutes } from './routes/agents.js';
import { ruleRoutes } from './routes/rules.js';
import { transactionRoutes } from './routes/transactions.js';
import { earningsRoutes } from './routes/earnings.js';
import { eventRoutes } from './routes/events.js';
import { healthRoutes } from './routes/health.js';

export function buildServer(pool: Pool, bagsClient: BAGSClient, broadcaster: EventBroadcaster) {
  const fastify = Fastify({ logger: true });

  // CORS
  fastify.register(cors, {
    origin: process.env['FRONTEND_ORIGIN'] ?? 'http://localhost:3000',
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS'],
  });

  // Routes
  fastify.register(authRoutes, { pool });
  fastify.register(agentRoutes, { pool });
  fastify.register(ruleRoutes, { pool });
  fastify.register(transactionRoutes, { pool });
  fastify.register(earningsRoutes, { pool, bagsClient });
  fastify.register(eventRoutes, { pool, broadcaster });
  fastify.register(healthRoutes, { pool });

  // Global error handler
  fastify.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Validation failed',
        fields: Object.fromEntries(error.errors.map((e) => [e.path.join('.'), e.message])),
      });
    }
    if (error instanceof ValidationError) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: error.message,
        fields: error.fields,
      });
    }
    if (error instanceof AuthError) {
      return reply.code(401).send({ error: 'AUTH_FAILED', message: error.message });
    }
    if (error instanceof NotFoundError) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: error.message });
    }
    if (error instanceof BAGSApiError) {
      const status = error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 502;
      return reply.code(status).send({ error: 'BAGS_API_ERROR', message: error.apiMessage });
    }
    fastify.log.error(error);
    return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
  });

  return fastify;
}
