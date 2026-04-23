import type { Pool } from 'pg';
import type { BAGSClient } from '../bags/BAGSClient.js';
import type {
  ActionDispatch,
  ActionResult,
  SplitActionConfig,
  ConvertActionConfig,
  ReinvestActionConfig,
} from '../types/index.js';
import { ValidationError, ActionExecutionError } from '../errors.js';
import { validateSplitConfig } from '../rules/validation.js';
import eventBus from '../eventBus.js';

export class ActionExecutor {
  constructor(private pool: Pool, private bagsClient: BAGSClient) {}

  async execute(dispatch: ActionDispatch): Promise<ActionResult> {
    const { agentId, ruleId, actionType, actionConfig, amountSOL } = dispatch;

    let txHash: string;

    try {
      if (actionType === 'split') {
        const validation = validateSplitConfig(actionConfig);
        if (!validation.success) {
          throw new ValidationError(validation.error);
        }
        const config = actionConfig as SplitActionConfig;
        const result = await this.bagsClient.routeFunds({
          sourceWallet: agentId,
          amountSOL,
          recipients: config.recipients,
        });
        txHash = result.txHash;
      } else if (actionType === 'convert') {
        const config = actionConfig as ConvertActionConfig;
        const result = await this.bagsClient.executeTrade({
          tokenId: 'USDC',
          side: 'buy',
          amountSOL: amountSOL * (config.percentage / 100),
          walletAddress: agentId,
        });
        txHash = result.txHash;
      } else {
        // reinvest
        const config = actionConfig as ReinvestActionConfig;
        const result = await this.bagsClient.executeTrade({
          tokenId: config.tokenId,
          side: 'buy',
          amountSOL: amountSOL * (config.percentage / 100),
          walletAddress: agentId,
        });
        txHash = result.txHash;
      }
    } catch (err) {
      // Re-throw ValidationError without wrapping (do not call BAGS)
      if (err instanceof ValidationError) {
        throw err;
      }

      const error = err instanceof Error ? err.message : String(err);
      const failedResult: ActionResult = {
        agentId,
        ruleId,
        actionType,
        amountSOL,
        txHash: null,
        executedAt: new Date().toISOString(),
        success: false,
        error,
      };
      eventBus.emit('action:result', failedResult);
      throw new ActionExecutionError(actionType, error, amountSOL);
    }

    const executedAt = new Date().toISOString();

    await this.pool.query(
      `INSERT INTO transactions (agent_id, rule_id, action_type, amount_sol, tx_hash, executed_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [agentId, ruleId, actionType, amountSOL, txHash],
    );

    const successResult: ActionResult = {
      agentId,
      ruleId,
      actionType,
      amountSOL,
      txHash,
      executedAt,
      success: true,
    };

    eventBus.emit('action:result', successResult);
    return successResult;
  }
}
