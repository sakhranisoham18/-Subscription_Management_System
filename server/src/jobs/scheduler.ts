import cron from 'node-cron';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { runBilling } from '../services/billing';

/**
 * Recurring billing scheduler (node-cron). Runs BILLING_CRON in APP_TIMEZONE.
 * The run itself is idempotent, so a missed or duplicated tick (e.g. two server instances)
 * cannot create duplicate invoices — the second run is rejected by the run lock, and the
 * per-period unique key protects against anything that slips through.
 */
export function startScheduler() {
  if (!env.BILLING_SCHEDULER_ENABLED) {
    logger.info('Billing scheduler disabled (BILLING_SCHEDULER_ENABLED=false)');
    return null;
  }
  if (!cron.validate(env.BILLING_CRON)) {
    logger.error({ cron: env.BILLING_CRON }, 'Invalid BILLING_CRON — scheduler not started');
    return null;
  }
  const task = cron.schedule(
    env.BILLING_CRON,
    async () => {
      try {
        const run = await runBilling({ trigger: 'SCHEDULED' });
        logger.info({ runId: run.id, created: run.invoicesCreated, failures: run.failures }, 'Scheduled billing run finished');
      } catch (err) {
        logger.error({ err }, 'Scheduled billing run failed');
      }
    },
    { timezone: env.APP_TIMEZONE, name: 'recurring-billing' },
  );
  logger.info({ cron: env.BILLING_CRON, timezone: env.APP_TIMEZONE }, 'Billing scheduler started');
  return task;
}
