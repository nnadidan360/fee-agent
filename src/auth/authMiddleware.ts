import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { validateJWT } from './authService.js';
import { AuthError } from '../errors.js';
import type { JWTPayload } from '../types/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    creatorWallet: string;
    jwtPayload: JWTPayload;
  }
}

export function authMiddleware(pool: Pool) {
  return async function (request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const authHeader = request.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AuthError('Missing or invalid Authorization header');
    }

    const token = authHeader.slice(7);
    const payload = await validateJWT(pool, token);

    request.creatorWallet = payload.sub;
    request.jwtPayload = payload;
  };
}
