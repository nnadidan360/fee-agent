import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env['DATABASE_URL'],
});

export default pool;

export async function query(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult> {
  return pool.query(text, params);
}
