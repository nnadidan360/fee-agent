import { readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Pool } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const MIGRATIONS_DIR = join(__dirname, 'migrations');

export async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .sort();

  for (const file of files) {
    const version = file.replace('.sql', '');

    const { rowCount } = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE version = $1',
      [version]
    );

    if ((rowCount ?? 0) > 0) {
      continue;
    }

    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');

    await pool.query('BEGIN');
    try {
      await pool.query(sql);
      await pool.query(
        'INSERT INTO schema_migrations (version) VALUES ($1)',
        [version]
      );
      await pool.query('COMMIT');
      console.log(`[migrate] Applied: ${file}`);
    } catch (err) {
      await pool.query('ROLLBACK');
      throw new Error(`[migrate] Failed to apply ${file}: ${err}`);
    }
  }
}
