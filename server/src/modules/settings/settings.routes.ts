import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { pageArgs, pageMeta, paginationQuery, parse } from '../../lib/http';
import { audit } from '../../lib/audit';
import { getSettings, saveSettings } from '../../lib/settings';
import { requirePermission } from '../../middleware/auth';
import { PERMISSIONS } from '../../domain/permissions';
import { smtpConfigured } from '../../services/email';
import { env } from '../../config/env';

export const settingsRouter = Router();

settingsRouter.get('/', requirePermission('dashboard:view'), async (_req, res) => {
  res.json({
    data: {
      ...(await getSettings()),
      emailMode: smtpConfigured() ? 'smtp' : 'dev',
      scheduler: { enabled: env.BILLING_SCHEDULER_ENABLED, cron: env.BILLING_CRON },
    },
  });
});

settingsRouter.patch('/', requirePermission('settings:manage'), async (req, res) => {
  const body = parse(
    z
      .object({
        companyName: z.string().trim().min(2).max(120),
        companyAddress: z.string().trim().max(300),
        companyEmail: z.string().trim().email(),
        companyTaxId: z.string().trim().max(40),
        currency: z.string().trim().length(3).toUpperCase(),
        timezone: z.string().refine((tz) => {
          try {
            new Intl.DateTimeFormat('en', { timeZone: tz });
            return true;
          } catch {
            return false;
          }
        }, 'Unknown timezone'),
        invoiceDueDays: z.coerce.number().int().min(0).max(180),
        autoConfirmRecurringInvoices: z.boolean(),
        quotationValidityDays: z.coerce.number().int().min(1).max(365),
      })
      .partial()
      .strict(),
    req.body,
  );
  const settings = await saveSettings(body);
  await audit({ actorId: req.user!.id, action: 'SETTINGS_UPDATED', entityType: 'Setting', details: body });
  res.json({ data: settings });
});

/** Permission matrix (read-only, from code) for the Staff & Settings page. */
settingsRouter.get('/permissions', requirePermission('settings:manage'), (_req, res) => {
  res.json({ data: PERMISSIONS });
});

/** Development outbox: emails "sent" while SMTP is not configured. */
settingsRouter.get('/outbox', requirePermission('settings:manage'), async (req, res) => {
  const q = parse(paginationQuery, req.query);
  const where = q.search ? { OR: [{ to: { contains: q.search, mode: 'insensitive' as const } }, { subject: { contains: q.search, mode: 'insensitive' as const } }] } : {};
  const [total, items] = await Promise.all([
    prisma.emailLog.count({ where }),
    prisma.emailLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }),
  ]);
  res.json({ data: items, meta: pageMeta(q, total) });
});

settingsRouter.get('/audit', requirePermission('audit:view'), async (req, res) => {
  const q = parse(paginationQuery.extend({ entityType: z.string().max(40).optional(), action: z.string().max(60).optional() }), req.query);
  const where = {
    entityType: q.entityType || undefined,
    action: q.action ? { contains: q.action.toUpperCase() } : undefined,
  };
  const [total, items] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q), include: { actor: { select: { name: true, role: true } } } }),
  ]);
  res.json({ data: items, meta: pageMeta(q, total) });
});
