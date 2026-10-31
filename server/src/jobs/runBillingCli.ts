/**
 * Development helper: run recurring billing once from the command line.
 *   npm run billing:run                # as of today
 *   npm run billing:run -- 2026-11-01  # as of a past date
 */
import { prisma } from '../lib/prisma';
import { runBilling } from '../services/billing';
import { toDateOnly } from '../domain/dates';

async function main() {
  const arg = process.argv[2];
  const run = await runBilling({ trigger: 'MANUAL', asOf: arg ? toDateOnly(arg) : undefined });
   
  console.log(
    `Billing run ${run.id}: ${run.status} — processed ${run.subscriptionsProcessed}, invoices ${run.invoicesCreated}, skipped ${run.skipped}, failures ${run.failures}`,
  );
}

main()
  .catch((err) => {
     
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
