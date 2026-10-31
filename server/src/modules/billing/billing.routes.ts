import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { dateString, idParam, pageArgs, pageMeta, paginationQuery, parse } from '../../lib/http';
import { notFound, unprocessable } from '../../lib/errors';
import { requirePermission } from '../../middleware/auth';
import { businessToday } from '../../lib/settings';
import { toDateOnly } from '../../domain/dates';
import { previewBilling, runBilling } from '../../services/billing';
import { env } from '../../config/env';

export const billingRouter = Router();
billingRouter.use(requirePermission('billing:run'));

/** Billing may be run for today or a past date only — never ahead of time. */
async function asOfDate(value?: string) {
  const today = await businessToday();
  if (!value) return today;
  const d = toDateOnly(value);
  if (d > today) throw unprocessable('Billing cannot be run for a future date');
  return d;
}

billingRouter.get('/preview', async (req, res) => {
  const q = parse(
    z.object({ asOf: dateString.optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) }),
    req.query,
  );
  res.json({ data: await previewBilling(await asOfDate(q.asOf), q.page, q.pageSize) });
});

billingRouter.post('/run', async (req, res) => {
  const body = parse(z.object({ asOf: dateString.optional() }), req.body ?? {});
  const run = await runBilling({ trigger: 'MANUAL', actorId: req.user!.id, asOf: await asOfDate(body.asOf) });
  res.status(201).json({ data: run });
});

billingRouter.get('/runs', async (req, res) => {
  const q = parse(paginationQuery, req.query);
  const [total, items] = await Promise.all([
    prisma.billingJobRun.count(),
    prisma.billingJobRun.findMany({ orderBy: { startedAt: 'desc' }, ...pageArgs(q), include: { triggeredBy: { select: { name: true } } } }),
  ]);
  res.json({
    data: items,
    meta: { ...pageMeta(q, total), scheduler: { enabled: env.BILLING_SCHEDULER_ENABLED, cron: env.BILLING_CRON, timezone: env.APP_TIMEZONE } },
  });
});

billingRouter.get('/runs/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const run = await prisma.billingJobRun.findUnique({
    where: { id },
    include: {
      triggeredBy: { select: { name: true } },
      events: {
        orderBy: { createdAt: 'asc' },
        take: 1000,
        include: {
          subscription: { select: { id: true, number: true, customer: { select: { name: true, companyName: true } } } },
          invoice: { select: { id: true, number: true, total: true } },
        },
      },
    },
  });
  if (!run) throw notFound('Billing run');
  res.json({ data: run });
});
