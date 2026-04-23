import { v4 as uuidv4 } from 'uuid';
import pino from 'pino';
import type { FastifyReply } from 'fastify';
import type { BroadcastEvent, FeeEvent, ActionResult } from '../types/index.js';
import eventBus from '../eventBus.js';

const logger = pino({ level: 'debug' });

export interface SSEConnection {
  id: string;
  creatorWallet: string;
  reply: FastifyReply;
  connectedAt: Date;
}

export class EventBroadcaster {
  // Map<creatorWallet, Map<connectionId, SSEConnection>>
  private connections = new Map<string, Map<string, SSEConnection>>();

  constructor() {
    eventBus.on('fee:event', (event: FeeEvent) => {
      const payload: BroadcastEvent = {
        eventType: 'fee_received',
        agentId: null,
        agentName: null,
        actionType: null,
        amountSOL: event.amountSOL,
        txHash: null,
        timestamp: event.timestamp,
      };
      this.broadcast(event.creatorWallet, payload);
    });

    eventBus.on('action:result', (result: ActionResult) => {
      // We need the creatorWallet — look it up from the agentId connection registry
      // Since we don't have a DB reference here, we broadcast to all wallets that have
      // a connection and match via agentId. In practice the RuleEngine sets agentId.
      // We'll emit to all connections and let the client filter, OR we store a
      // agentId→creatorWallet mapping. For simplicity, broadcast to all wallets.
      const payload: BroadcastEvent = {
        eventType: result.success ? 'action_executed' : 'action_failed',
        agentId: result.agentId,
        agentName: null, // name not available here without DB
        actionType: result.actionType,
        amountSOL: result.amountSOL,
        txHash: result.txHash,
        timestamp: result.executedAt,
      };
      // Broadcast to all connected wallets (SSE clients filter by their own agentId)
      for (const wallet of this.connections.keys()) {
        this.broadcast(wallet, payload);
      }
    });
  }

  register(conn: Omit<SSEConnection, 'id'>): string {
    const id = uuidv4();
    const full: SSEConnection = { ...conn, id };
    let walletMap = this.connections.get(conn.creatorWallet);
    if (!walletMap) {
      walletMap = new Map();
      this.connections.set(conn.creatorWallet, walletMap);
    }
    walletMap.set(id, full);
    logger.debug({ id, creatorWallet: conn.creatorWallet }, 'EventBroadcaster: connection registered');
    return id;
  }

  unregister(connectionId: string): void {
    for (const [wallet, walletMap] of this.connections) {
      if (walletMap.delete(connectionId)) {
        if (walletMap.size === 0) this.connections.delete(wallet);
        logger.debug({ connectionId }, 'EventBroadcaster: connection unregistered');
        return;
      }
    }
  }

  broadcast(creatorWallet: string, event: BroadcastEvent): void {
    const walletMap = this.connections.get(creatorWallet);
    if (!walletMap) return;

    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const [id, conn] of walletMap) {
      try {
        conn.reply.raw.write(payload);
      } catch (err) {
        logger.warn({ id, err }, 'EventBroadcaster: write error, unregistering connection');
        this.unregister(id);
      }
    }
  }
}

// Singleton
let _instance: EventBroadcaster | null = null;

export function getEventBroadcaster(): EventBroadcaster {
  if (!_instance) _instance = new EventBroadcaster();
  return _instance;
}
