import pino from 'pino';
import type { Pool } from 'pg';
import type { ActionExecutor } from '../executor/ActionExecutor.js';
import type { FeeEvent } from '../types/index.js';
import eventBus from '../eventBus.js';
import { evaluateThresholdCondition, evaluateReferralCondition } from './conditions.js';
import { makeEventIdempotencyKey } from '../idempotency/keys.js';
import { tryInsertPending, markExecuted, markFailed } from '../idempotency/store.js';

const logger = pino({ level: 'debug' });

interface RuleRow {
  id: string;
  agent_id: string;
  condition_type: 'threshold' | 'referral';
  condition_value: string;
  action_type: string;
  action_config: unknown;
}

export class RuleEngine {
  private agentQueues = new Map<string, Promise<void>>();
  private handler: ((event: FeeEvent) => void) | null = null;

  constructor(private pool: Pool, private executor: ActionExecutor) {}

  start(): void {
    this.handler = (event: FeeEvent) => {
      this.processEvent(event);
    };
    eventBus.on('fee:event', this.handler);
  }

  stop(): void {
    if (this.handler) {
      eventBus.off('fee:event', this.handler);
      this.handler = null;
    }
  }

  private processEvent(event: FeeEvent): void {
    // Load rules and group by agent_id, then chain per-agent
    this.loadAndDispatch(event).catch((err) => {
      logger.error({ err }, 'RuleEngine: failed to load/dispatch rules');
    });
  }

  private async loadAndDispatch(event: FeeEvent): Promise<void> {
    const { rows } = await this.pool.query<RuleRow>(
      `SELECT r.id, r.agent_id, r.condition_type, r.condition_value, r.action_type, r.action_config
       FROM rules r
       JOIN agents a ON a.id = r.agent_id
       WHERE a.status = 'active'
         AND r.condition_type IN ('threshold', 'referral')`,
    );

    // Group rules by agent_id
    const byAgent = new Map<string, RuleRow[]>();
    for (const row of rows) {
      const list = byAgent.get(row.agent_id) ?? [];
      list.push(row);
      byAgent.set(row.agent_id, list);
    }

    // Chain per-agent processing onto the per-agent promise queue
    for (const [agentId, rules] of byAgent) {
      const prev = this.agentQueues.get(agentId) ?? Promise.resolve();
      const next = prev.then(() => this.processAgentRules(agentId, rules, event));
      this.agentQueues.set(agentId, next);
    }
  }

  private async processAgentRules(
    agentId: string,
    rules: RuleRow[],
    event: FeeEvent,
  ): Promise<void> {
    for (const rule of rules) {
      await this.processRule(agentId, rule, event);
    }
  }

  private async processRule(agentId: string, rule: RuleRow, event: FeeEvent): Promise<void> {
    const { id: ruleId, condition_type, condition_value, action_type, action_config } = rule;

    // Evaluate condition
    let conditionMet: boolean;
    if (condition_type === 'threshold') {
      conditionMet = evaluateThresholdCondition(event.amountSOL, condition_value);
    } else {
      conditionMet = evaluateReferralCondition(event.referralSource, condition_value);
    }

    if (!conditionMet) {
      logger.debug(
        { ruleId, conditionType: condition_type, conditionValue: condition_value, amountSOL: event.amountSOL, result: 'skipped' },
        'RuleEngine: condition not met',
      );
      return;
    }

    const key = makeEventIdempotencyKey(event.eventId, ruleId);
    const inserted = await tryInsertPending(this.pool, key);

    if (!inserted) {
      logger.warn({ ruleId, key }, 'RuleEngine: duplicate event, skipping');
      return;
    }

    try {
      const result = await this.executor.execute({
        agentId,
        ruleId,
        actionType: action_type as 'split' | 'convert' | 'reinvest',
        actionConfig: action_config as never,
        amountSOL: event.amountSOL,
        idempotencyKey: key,
      });

      await markExecuted(this.pool, key, result.txHash!);

      await this.pool.query(
        `UPDATE agents SET status = 'triggered', updated_at = NOW() WHERE id = $1`,
        [agentId],
      );

      logger.debug(
        { ruleId, conditionType: condition_type, conditionValue: condition_value, amountSOL: event.amountSOL, result: 'triggered' },
        'RuleEngine: rule triggered',
      );
    } catch (err) {
      await markFailed(this.pool, key);
      logger.error({ err, ruleId }, 'RuleEngine: action execution failed');
      // Do NOT rethrow — don't block other rules
    }
  }
}
