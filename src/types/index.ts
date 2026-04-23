// ─── Enums / Union Types ──────────────────────────────────────────────────────

export type AgentStatus = 'active' | 'paused' | 'triggered';
export type ConditionType = 'threshold' | 'time' | 'referral';
export type ActionType = 'split' | 'convert' | 'reinvest';
export type TimeInterval = 'hourly' | 'daily' | 'weekly';
export type IdempotencyStatus = 'pending' | 'executed' | 'failed';

// ─── Agent ────────────────────────────────────────────────────────────────────

export interface Agent {
  id: string;            // UUID v4
  creatorWallet: string; // Solana public key (base58)
  name: string;
  status: AgentStatus;
  createdAt: string;     // ISO 8601 UTC
  updatedAt: string;     // ISO 8601 UTC
}

// ─── Rule & ActionConfig ──────────────────────────────────────────────────────

export interface SplitRecipient {
  wallet: string;     // Solana public key (base58)
  percentage: number; // 0–100; all recipients must sum to 100
}

export interface SplitActionConfig {
  recipients: SplitRecipient[];
}

export interface ConvertActionConfig {
  percentage: number;    // % of fee amount to convert
  targetToken: 'USDC';
}

export interface ReinvestActionConfig {
  percentage: number; // % of fee amount to reinvest
  tokenId: string;    // creator token to buy
}

export type ActionConfig = SplitActionConfig | ConvertActionConfig | ReinvestActionConfig;

export interface Rule {
  id: string;                  // UUID v4
  agentId: string;             // FK to Agent
  conditionType: ConditionType;
  conditionValue: string;      // SOL amount (threshold) | interval (time) | referral string
  actionType: ActionType;
  actionConfig: ActionConfig;
  createdAt: string;           // ISO 8601 UTC
}

// ─── Transaction ──────────────────────────────────────────────────────────────

export interface Transaction {
  id: string;          // UUID v4
  agentId: string;     // FK to Agent
  ruleId: string;      // FK to Rule
  actionType: ActionType;
  amountSOL: number;
  txHash: string;
  executedAt: string;  // ISO 8601 UTC
}

// ─── Idempotency ──────────────────────────────────────────────────────────────

export interface IdempotencyKey {
  key: string;                // PRIMARY KEY: sha256(eventId+ruleId) or sha256(ruleId+intervalBoundary)
  status: IdempotencyStatus;
  txHash: string | null;
  createdAt: string;          // ISO 8601 UTC
  updatedAt: string;          // ISO 8601 UTC
}

// ─── Fee Event ────────────────────────────────────────────────────────────────

export interface FeeEvent {
  eventId: string;
  creatorWallet: string;
  amountSOL: number;
  tokenId: string;
  referralSource: string | null;
  timestamp: string; // ISO 8601
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface JWTPayload {
  sub: string;  // creatorWallet
  iat: number;
  exp: number;  // iat + 86400 (24 h)
  jti: string;  // UUID, used for server-side invalidation
}

export interface NonceRecord {
  nonce: string;         // PRIMARY KEY, UUID v4
  walletAddress: string;
  expiresAt: Date;
  usedAt: Date | null;   // set when consumed
}

export interface RevokedToken {
  jti: string;       // PRIMARY KEY
  revokedAt: Date;
  expiresAt: Date;   // same as JWT exp, for cleanup
}

// ─── SSE / EventBroadcaster ───────────────────────────────────────────────────

export interface BroadcastEvent {
  eventType: 'fee_received' | 'action_executed' | 'action_failed';
  agentId: string | null;
  agentName: string | null;
  actionType: ActionType | null;
  amountSOL: number;
  txHash: string | null;
  timestamp: string; // ISO 8601
}

// ─── ActionExecutor ───────────────────────────────────────────────────────────

export interface ActionDispatch {
  agentId: string;
  ruleId: string;
  actionType: ActionType;
  actionConfig: ActionConfig;
  amountSOL: number;
  idempotencyKey: string;
}

export interface ActionResult {
  agentId: string;
  ruleId: string;
  actionType: ActionType;
  amountSOL: number;
  txHash: string | null;
  executedAt: string; // ISO 8601
  success: boolean;
  error?: string;
}
