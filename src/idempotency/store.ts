import type { Pool } from 'pg';

export async function tryInsertPending(pool: Pool, key: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO idempotency_keys (key, status, created_at, updated_at)
       VALUES ($1, 'pending', NOW(), NOW())
       ON CONFLICT (key) DO NOTHING`,
      [key]
    );
    await client.query('COMMIT');
    return result.rowCount === 1;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function markExecuted(pool: Pool, key: string, txHash: string): Promise<void> {
  await pool.query(
    `UPDATE idempotency_keys SET status = 'executed', tx_hash = $2, updated_at = NOW() WHERE key = $1`,
    [key, txHash]
  );
}

export async function markFailed(pool: Pool, key: string): Promise<void> {
  await pool.query(
    `UPDATE idempotency_keys SET status = 'failed', updated_at = NOW() WHERE key = $1`,
    [key]
  );
}
