import { env } from './config/env';
import { createApp } from './app';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { startScheduler } from './jobs/scheduler';

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info(`Brightloop Software — Subscription Management System API listening on http://localhost:${env.PORT} (docs: /api/docs)`);
});
const scheduler = startScheduler();

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  await scheduler?.stop();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
