import WebSocket from 'ws';
import pino from 'pino';
import type { FeeEvent } from '../types/index.js';
import eventBus from '../eventBus.js';

const logger = pino({ level: 'debug' });

const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];

interface RawRestreamEvent {
  id: string;
  creator: string;
  amount: number;
  token: string;
  referral?: string;
  ts: string;
}

function normalize(raw: RawRestreamEvent): FeeEvent {
  return {
    eventId: raw.id,
    creatorWallet: raw.creator,
    amountSOL: raw.amount,
    tokenId: raw.token,
    referralSource: raw.referral ?? null,
    timestamp: raw.ts,
  };
}

export class RestreamListener {
  private ws: WebSocket | null = null;
  private lastProcessedEventIds = new Set<string>();
  private stopped = false;

  constructor(private restreamUrl: string) {}

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect(0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }

  private async connect(attempt: number): Promise<void> {
    if (this.stopped) return;

    return new Promise((resolve) => {
      const ws = new WebSocket(this.restreamUrl);
      this.ws = ws;

      ws.once('open', () => {
        logger.info('RestreamListener: connected');
        resolve();
      });

      ws.on('message', (data) => {
        try {
          const raw = JSON.parse(data.toString()) as RawRestreamEvent;
          if (this.lastProcessedEventIds.has(raw.id)) {
            logger.debug({ eventId: raw.id }, 'RestreamListener: duplicate event, skipping');
            return;
          }
          const event = normalize(raw);
          this.lastProcessedEventIds.add(event.eventId);
          logger.debug({ eventId: event.eventId, creatorWallet: event.creatorWallet }, 'RestreamListener: fee event received');
          eventBus.emit('fee:event', event);
        } catch (err) {
          logger.error({ err }, 'RestreamListener: failed to parse message');
        }
      });

      ws.once('error', (err) => {
        logger.error({ err }, 'RestreamListener: WebSocket error');
      });

      ws.once('close', () => {
        if (this.stopped) return;
        this.scheduleReconnect(attempt + 1);
      });

      // If open fails, resolve anyway so start() doesn't hang
      ws.once('error', () => resolve());
    });
  }

  private scheduleReconnect(attempt: number): void {
    if (this.stopped) return;

    if (attempt >= RETRY_DELAYS_MS.length) {
      logger.fatal(
        { attempts: attempt },
        'RestreamListener: CRITICAL — max reconnect attempts reached, giving up',
      );
      return;
    }

    const delay = RETRY_DELAYS_MS[attempt]!;
    logger.warn({ attempt, delay }, 'RestreamListener: reconnecting...');
    setTimeout(() => {
      this.connect(attempt).catch((err) => {
        logger.error({ err }, 'RestreamListener: reconnect failed');
      });
    }, delay);
  }
}
