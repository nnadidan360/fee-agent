import cron from 'node-cron';
import pino from 'pino';
import type { Pool } from 'pg';
import type { BAGSClient } from '../bags/BAGSClient.js';
import type { ActionExecutor } from '../executor/ActionExecutor.js';
import type { TimeInterval } from '../types/index.js';
import { makeTimeIdempotencyKey, floorToInterval } from '../idempotency/keys.js';
import { tryInsertPending, markExecuted, markFailed } from '../idempotency/store.js';

const logger = pino({ level: 'debug' });

interface TimeRuleRow {
  id: string;
  agent_id: string;
  creator_wallet: string;
  condition_value: TimeInterval;
  action_type: string;
  action_config: unknown;
}

export class BackgroundWorker {
  private tasks: cron.ScheduledTask[] = [];

  constructor(
    private pool: Pool,
    private bagsClient: BAGSClient,
    private executor: ActionExecutor,
  ) {}

  start(): void {
    // Hourly
    this.tasks.push(
      cron.schedule('0 * * * *', () => {
        this.runCycle('hourly').catch((err) =>
          logger.error({ err }, 'BackgroundWorker: unhandled error in hourly cycle'),
        );
      }),
    );

    // Daily
    this.tasks.push(
      cron.schedule('0 0 * * *', () => {
        this.runCycle('daily').catch((err) =>
          logger.error({ err }, 'BackgroundWorker: unhandled error in daily cycle'),
        );
      }),
    );

    // Weekly (Monday 00:00)
    this.tasks.push(
      cron.schedule('0 0 * * 1', () => {
        this.runCycle('weekly').catch((err) =>
          logger.error({ err }, 'BackgroundWorker: unhandled error in weekly cycle'),
        );
      }),
    );

    logger.info('BackgroundWorker: started (hourly, daily, weekly)');
  }

  stop(): void {
    for (const task of this.tasks) task.stop();
    this.tasks = [];
    logger.info('BackgroundWorker: stopped');
  }

  private async runCycle(interval: TimeInterval): Promise<void> {
    const now = new Date();
    const boundary = floorToInterval(now, interval);

    logger.info({ interval, boundary }, 'BackgroundWorker: cycle start');

    let rules: TimeRuleRow[];
    try {
      const { rows } = await this.pool.query<TimeRuleRow>(
        `SELECT r.id, r.agent_id, a.creator_wallet, r.condition_value, r.action_type, r.action_config
         FROM rules r
         JOIN agents a ON a.id = r.agent_id
         WHERE r.condition_type = 'time'
           AND r.condition_value = $1
           AND a.status = 'active'`,
        [interval],
      );
      rules = rows;
    } catch (err) {
      logger.error({ err, interval }, 'BackgroundWorker: failed to load rules');
      return;
    }

    logger.info({ interval, rulesEvaluated: rules.length }, 'BackgroundWorker: rules loaded');

    let dispatched = 0;

    for (const rule of rules) {
      try {
        // Fetch fee balance
        const fees = await this.bagsClient.getFeesGenerated(rule.creator_wallet);
        const balance = fees.reduce((sum, f) => sum + f.amountSOL, 0);

        if (balance <= 0) {
          logger.debug({ ruleId: rule.id, balance }, 'BackgroundWorker: zero balance, skipping');
          continue;
        }

        const key = makeTimeIdempotencyKey(rule.id, boundary);
        const inserted = await tryInsertPending(this.pool, key);

        if (!inserted) {
          logger.debug({ ruleId: rule.id, key }, 'BackgroundWorker: duplicate key, skipping');
          continue;
        }

        const result = await this.executor.execute({
          agentId: rule.agent_id,
          ruleId: rule.id,
          actionType: rule.action_type as 'split' | 'convert' | 'reinvest',
          actionConfig: rule.action_config as never,
          amountSOL: balance,
          idempotencyKey: key,
        });

        await markExecuted(this.pool, key, result.txHash!);
        dispatched++;
      } catch (err) {
        logger.error({ err, ruleId: rule.id }, 'BackgroundWorker: error processing rule');
        // continue to next rule
      }
    }

    logger.info({ interval, rulesEvaluated: rules.length, actionsDispatched: dispatched }, 'BackgroundWorker: cycle complete');
  }
}
