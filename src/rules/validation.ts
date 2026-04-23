import { PublicKey } from '@solana/web3.js';
import { z } from 'zod';
import type { ConditionType, ActionType } from '../types/index.js';

// ─── Split Config Validation ──────────────────────────────────────────────────

export function validateSplitConfig(
  config: unknown,
): { success: true } | { success: false; error: string } {
  if (
    typeof config !== 'object' ||
    config === null ||
    !Array.isArray((config as Record<string, unknown>).recipients)
  ) {
    return { success: false, error: 'config.recipients must be an array' };
  }

  const { recipients } = config as { recipients: unknown[] };

  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i];
    if (typeof r !== 'object' || r === null) {
      return { success: false, error: `recipients[${i}] must be an object` };
    }
    const { wallet } = r as Record<string, unknown>;
    if (typeof wallet !== 'string') {
      return { success: false, error: `recipients[${i}].wallet must be a string` };
    }
    try {
      new PublicKey(wallet);
    } catch {
      return {
        success: false,
        error: `recipients[${i}].wallet is not a valid Solana public key: "${wallet}"`,
      };
    }
  }

  const total = recipients.reduce<number>((sum, r) => {
    const pct = (r as Record<string, unknown>).percentage;
    return sum + (typeof pct === 'number' ? pct : 0);
  }, 0);

  if (total !== 100) {
    return {
      success: false,
      error: `recipient percentages must sum to exactly 100, got ${total}`,
    };
  }

  return { success: true };
}

// ─── Type Guards ──────────────────────────────────────────────────────────────

export function validateConditionType(v: unknown): v is ConditionType {
  return v === 'threshold' || v === 'time' || v === 'referral';
}

export function validateActionType(v: unknown): v is ActionType {
  return v === 'split' || v === 'convert' || v === 'reinvest';
}

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

export const CreateRuleBodySchema = z.object({
  conditionType: z.enum(['threshold', 'time', 'referral']),
  conditionValue: z.string().min(1),
  actionType: z.enum(['split', 'convert', 'reinvest']),
  actionConfig: z.record(z.unknown()),
});

export const UpdateRuleBodySchema = CreateRuleBodySchema.partial();

export type CreateRuleBody = z.infer<typeof CreateRuleBodySchema>;
export type UpdateRuleBody = z.infer<typeof UpdateRuleBodySchema>;
