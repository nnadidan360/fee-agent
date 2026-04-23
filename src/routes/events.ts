import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { validateJWT } from '../auth/authService.js';
import { AuthError } from '../errors.js';
import type { EventBroadcaster } from '../sse/EventBroadcaster.js';

export async function eventRoutes(
  fastify: FastifyInstance,
  opts: { pool: Pool; broadcaster: EventBroadcaster },
): Promise<void> {
  const { pool, broadcaster } = opts;

  fastify.get('/events', async (request, reply) => {
    // Accept JWT from Authorization header or ?token= query param (EventSource compat)
    const authHeader = request.headers['authorization'];
    const queryToken = (request.query as Record<string, string>)['token'];
    const rawToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : queryToken;

    if (!rawToken) throw new AuthError('Missing token');

    const payload = await validateJWT(pool, rawToken);

    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const connectionId = broadcaster.register({
      creatorWallet: payload.sub,
      reply,
      connectedAt: new Date(),
    });

    // Send initial connected event
    reply.raw.write(`data: ${JSON.stringify({ eventType: 'connected', agentId: null, agentName: null, actionType: null, amountSOL: 0, txHash: null, timestamp: new Date().toISOString() })}\n\n`);

    // Heartbeat every 30s
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(': ping\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 30_000);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      broadcaster.unregister(connectionId);
    });

    // Keep the connection open — do not call reply.send()
    await new Promise<void>((resolve) => {
      request.raw.on('close', resolve);
    });
  });
}
