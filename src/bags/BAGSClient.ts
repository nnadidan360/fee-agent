import { BAGSApiError } from '../errors.js';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface TokenInfo {
  tokenId: string;
  name: string;
  symbol: string;
  mintAddress: string;
  creatorWallet: string;
  totalSupply: number;
  price: number;
}

export interface TradeRecord {
  tradeId: string;
  tokenId: string;
  side: 'buy' | 'sell';
  amountSOL: number;
  amountToken: number;
  walletAddress: string;
  timestamp: string; // ISO 8601
}

export interface FeeRecord {
  timestamp: string; // ISO 8601
  amountSOL: number;
}

export interface ExecuteTradeParams {
  tokenId: string;
  side: 'buy' | 'sell';
  amountSOL: number;
  walletAddress: string;
}

export interface RouteFundsParams {
  sourceWallet: string;
  amountSOL: number;
  recipients: Array<{ wallet: string; percentage: number }>;
}

// ─── Config ───────────────────────────────────────────────────────────────────

interface BAGSClientConfig {
  apiKey: string;
  baseUrl: string;
}

// ─── Retry delays for 429 responses ──────────────────────────────────────────

const RETRY_DELAYS_MS = [1000, 2000, 4000];

// ─── BAGSClient ───────────────────────────────────────────────────────────────

export class BAGSClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: BAGSClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
  }

  private defaultHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-BAGS-API-KEY': this.apiKey,
    };
  }

  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    let lastError: BAGSApiError | null = null;

    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
      const response = await fetch(url, init);

      if (response.ok) {
        return response;
      }

      if (response.status === 429) {
        lastError = new BAGSApiError(429, 'Too Many Requests');
        if (attempt < RETRY_DELAYS_MS.length - 1) {
          await sleep(RETRY_DELAYS_MS[attempt]);
          continue;
        }
        // All retries exhausted
        throw lastError;
      }

      // Non-2xx, non-429: throw immediately
      let apiMessage = response.statusText;
      try {
        const body = await response.json() as { message?: string; error?: string };
        apiMessage = body.message ?? body.error ?? apiMessage;
      } catch {
        // ignore parse errors; use statusText
      }
      throw new BAGSApiError(response.status, apiMessage);
    }

    // Should not reach here, but satisfy TypeScript
    throw lastError ?? new BAGSApiError(500, 'Unknown error');
  }

  async getTokenInfo(tokenId: string): Promise<TokenInfo> {
    const url = `${this.baseUrl}/tokens/${encodeURIComponent(tokenId)}`;
    const response = await this.fetchWithRetry(url, {
      method: 'GET',
      headers: this.defaultHeaders(),
    });
    return response.json() as Promise<TokenInfo>;
  }

  async getTrades(
    tokenId: string,
    options?: { limit?: number; before?: string },
  ): Promise<TradeRecord[]> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) params.set('limit', String(options.limit));
    if (options?.before !== undefined) params.set('before', options.before);

    const query = params.toString() ? `?${params.toString()}` : '';
    const url = `${this.baseUrl}/tokens/${encodeURIComponent(tokenId)}/trades${query}`;

    const response = await this.fetchWithRetry(url, {
      method: 'GET',
      headers: this.defaultHeaders(),
    });
    return response.json() as Promise<TradeRecord[]>;
  }

  async getFeesGenerated(
    creatorWallet: string,
    options?: { range?: '7d' | '30d' | '90d' },
  ): Promise<FeeRecord[]> {
    const params = new URLSearchParams();
    if (options?.range !== undefined) params.set('range', options.range);

    const query = params.toString() ? `?${params.toString()}` : '';
    const url = `${this.baseUrl}/creators/${encodeURIComponent(creatorWallet)}/fees${query}`;

    const response = await this.fetchWithRetry(url, {
      method: 'GET',
      headers: this.defaultHeaders(),
    });
    return response.json() as Promise<FeeRecord[]>;
  }

  async executeTrade(params: ExecuteTradeParams): Promise<{ txHash: string }> {
    const url = `${this.baseUrl}/trades`;
    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: this.defaultHeaders(),
      body: JSON.stringify(params),
    });
    return response.json() as Promise<{ txHash: string }>;
  }

  async routeFunds(params: RouteFundsParams): Promise<{ txHash: string }> {
    const url = `${this.baseUrl}/funds/route`;
    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: this.defaultHeaders(),
      body: JSON.stringify(params),
    });
    return response.json() as Promise<{ txHash: string }>;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _instance: BAGSClient | null = null;

export function createBAGSClient(config: BAGSClientConfig): BAGSClient {
  return new BAGSClient(config);
}

export function getBAGSClient(): BAGSClient {
  if (!_instance) {
    const apiKey = process.env['BAGS_API_KEY'];
    const baseUrl = process.env['BAGS_API_BASE_URL'];

    if (!apiKey) throw new Error('BAGS_API_KEY environment variable is not set');
    if (!baseUrl) throw new Error('BAGS_API_BASE_URL environment variable is not set');

    _instance = new BAGSClient({ apiKey, baseUrl });
  }
  return _instance;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
