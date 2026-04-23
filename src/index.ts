import 'dotenv/config';
import pool from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { getBAGSClient } from './bags/BAGSClient.js';
import { getEventBroadcaster } from './sse/EventBroadcaster.js';
import { ActionExecutor } from './executor/ActionExecutor.js';
import { RuleEngine } from './engine/RuleEngine.js';
import { RestreamListener } from './restream/RestreamListener.js';
import { BackgroundWorker } from './worker/BackgroundWorker.js';
import { buildServer } from './server.js';

async function main() {
  // Run DB migrations
  await runMigrations(pool);

  const bagsClient = getBAGSClient();
  const broadcaster = getEventBroadcaster();
  const executor = new ActionExecutor(pool, bagsClient);
  const ruleEngine = new RuleEngine(pool, executor);
  const restreamListener = new RestreamListener(
    process.env['BAGS_RESTREAM_URL'] ?? 'wss://restream.bags.fm',
  );
  const backgroundWorker = new BackgroundWorker(pool, bagsClient, executor);

  // Start background services
  ruleEngine.start();
  backgroundWorker.start();
  await restreamListener.start();

  // Build and start HTTP server
  const server = buildServer(pool, bagsClient, broadcaster);
  const port = parseInt(process.env['PORT'] ?? '4000', 10);

  await server.listen({ port, host: '0.0.0.0' });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    server.log.info(`Received ${signal}, shutting down...`);
    ruleEngine.stop();
    backgroundWorker.stop();
    await restreamListener.stop();
    await server.close();
    await pool.end();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
