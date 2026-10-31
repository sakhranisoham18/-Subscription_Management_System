import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { idParam, optionalText, orderBy, pageArgs, pageMeta, paginationQuery, parse } from '../../lib/http';
import { conflict, notFound, unprocessable } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { hashPassword } from '../../lib/tokens';
import { requirePermission } from '../../middleware/auth';
import { normalizeEmail } from '../../domain/password';
import { businessToday } from '../../lib/settings';
import { sendPasswordLink } from '../auth/auth.routes';
import { toMoneyString } from '../../domain/money';

export const customersRouter = Router();

export const customerFields = z.object({
  name: z.string().trim().min(2, 'Enter the contact name').max(120),
  companyName: optionalText(160),
  email: z.string().trim().email('Enter a valid email').transform(normalizeEmail),
  phone: optionalText(30),
  billingContact: optionalText(120),
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(80),
  state: optionalText(80),
  postalCode: optionalText(20),
  country: optionalText(80),
  taxId: optionalText(40),
  notes: optionalText(2000),
});

customersRouter.get('/', requirePermission('customers:read'), async (req, res) => {
  const q = parse(paginationQuery.extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() }), req.query);
  const where: Prisma.CustomerWhereInput = {
    status: q.status,
    ...(q.search
      ? {
          OR: [
            { name: { contains: q.search, mode: 'insensitive' } },
            { companyName: { contains: q.search, mode: 'insensitive' } },
            { email: { contains: q.search, mode: 'insensitive' } },
            { phone: { contains: q.search } },
          ],
        }
      : {}),
  };
  const [total, items] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      orderBy: orderBy(q, ['name', 'companyName', 'email', 'createdAt'] as const, 'createdAt'),
      ...pageArgs(q),
      select: {
        id: true,
        name: true,
        companyName: true,
        email: true,
        phone: true,
        city: true,
        status: true,
        createdAt: true,
        userId: true,
        _count: { select: { subscriptions: { where: { status: 'ACTIVE' } } } },
      },
    }),
  ]);
  // outstanding balance per customer on this page (single grouped query, no N+1)
  const balances = await prisma.invoice.groupBy({
    by: ['customerId'],
    where: { customerId: { in: items.map((c) => c.id) }, status: { in: ['CONFIRMED', 'PARTIALLY_PAID'] } },
    _sum: { balanceDue: true },
  });
  const balanceMap = new Map(balances.map((b) => [b.customerId, b._sum.balanceDue]));
  res.json({
    data: items.map(({ _count, userId, ...c }) => ({
      ...c,
      hasPortalAccess: Boolean(userId),
      activeSubscriptions: _count.subscriptions,
      outstanding: toMoneyString(balanceMap.get(c.id) ?? 0),
    })),
    meta: pageMeta(q, total),
  });
});

customersRouter.get('/:id', requirePermission('customers:read'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: { user: { select: { id: true, status: true, lastLoginAt: true } } },
  });
  if (!customer) throw notFound('Customer');
  const today = await businessToday();
  const [subscriptions, quotations, invoices, payments, open, overdue, paid, activity] = await Promise.all([
    prisma.subscription.findMany({
      where: { customerId: id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, number: true, status: true, startDate: true, endDate: true, nextBillingDate: true, total: true, plan: { select: { name: true } } },
    }),
    prisma.quotation.findMany({
      where: { customerId: id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, number: true, status: true, quotationDate: true, validUntil: true, total: true },
    }),
    prisma.invoice.findMany({
      where: { customerId: id },
      orderBy: { invoiceDate: 'desc' },
      take: 20,
      select: { id: true, number: true, status: true, invoiceDate: true, dueDate: true, total: true, balanceDue: true },
    }),
    prisma.payment.findMany({
      where: { customerId: id },
      orderBy: { paymentDate: 'desc' },
      take: 20,
      select: { id: true, number: true, method: true, amount: true, paymentDate: true, status: true },
    }),
    prisma.invoice.aggregate({ where: { customerId: id, status: { in: ['CONFIRMED', 'PARTIALLY_PAID'] } }, _sum: { balanceDue: true } }),
    prisma.invoice.aggregate({
      where: { customerId: id, status: { in: ['CONFIRMED', 'PARTIALLY_PAID'] }, dueDate: { lt: today }, balanceDue: { gt: 0 } },
      _sum: { balanceDue: true },
      _count: true,
    }),
    prisma.payment.aggregate({ where: { customerId: id, status: 'COMPLETED' }, _sum: { amount: true } }),
    prisma.auditLog.findMany({
      where: { OR: [{ entityType: 'Customer', entityId: id }] },
      orderBy: { createdAt: 'desc' },
      take: 15,
      include: { actor: { select: { name: true } } },
    }),
  ]);
  res.json({
    data: {
      ...customer,
      hasPortalAccess: Boolean(customer.userId),
      summary: {
        outstanding: toMoneyString(open._sum.balanceDue ?? 0),
        overdue: toMoneyString(overdue._sum.balanceDue ?? 0),
        overdueCount: overdue._count,
        totalPaid: toMoneyString(paid._sum.amount ?? 0),
        activeSubscriptions: subscriptions.filter((s) => s.status === 'ACTIVE').length,
      },
      subscriptions,
      quotations,
      invoices: invoices.map((i) => ({
        ...i,
        isOverdue: ['CONFIRMED', 'PARTIALLY_PAID'].includes(i.status) && i.dueDate < today && Number(i.balanceDue) > 0,
      })),
      payments,
      activity,
    },
  });
});

customersRouter.post('/', requirePermission('customers:write'), async (req, res) => {
  const body = parse(customerFields, req.body);
  const [u, c] = await Promise.all([
    prisma.user.findUnique({ where: { email: body.email }, select: { id: true } }),
    prisma.customer.findUnique({ where: { email: body.email }, select: { id: true } }),
  ]);
  if (u || c) throw conflict('A customer or user with this email already exists', { fields: { email: 'Email already in use' } });
  const customer = await prisma.customer.create({ data: body });
  await audit({ actorId: req.user!.id, action: 'CUSTOMER_CREATED', entityType: 'Customer', entityId: customer.id, ip: req.ip });
  res.status(201).json({ data: customer });
});

customersRouter.patch('/:id', requirePermission('customers:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const body = parse(customerFields.partial().extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() }), req.body);
  const existing = await prisma.customer.findUnique({ where: { id } });
  if (!existing) throw notFound('Customer');
  if (body.email && body.email !== existing.email) {
    const clash = await Promise.all([
      prisma.user.findFirst({ where: { email: body.email, NOT: { id: existing.userId ?? undefined } }, select: { id: true } }),
      prisma.customer.findUnique({ where: { email: body.email }, select: { id: true } }),
    ]);
    if (clash.some(Boolean)) throw conflict('Email already in use', { fields: { email: 'Email already in use' } });
  }
  const customer = await prisma.$transaction(async (tx) => {
    const updated = await tx.customer.update({ where: { id }, data: body });
    if (existing.userId) {
      await tx.user.update({
        where: { id: existing.userId },
        data: {
          ...(body.email ? { email: body.email } : {}),
          ...(body.name ? { name: body.name } : {}),
          ...(body.status ? { status: body.status } : {}),
        },
      });
      if (body.status === 'INACTIVE') {
        await tx.refreshToken.updateMany({ where: { userId: existing.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      }
    }
    await audit({ actorId: req.user!.id, action: 'CUSTOMER_UPDATED', entityType: 'Customer', entityId: id, details: Object.keys(body), ip: req.ip }, tx);
    return updated;
  });
  res.json({ data: customer });
});

/** Gives a staff-created customer access to the portal by emailing a set-password link. */
customersRouter.post('/:id/invite', requirePermission('customers:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer) throw notFound('Customer');
  if (customer.status !== 'ACTIVE') throw unprocessable('Activate the customer before inviting them');
  let userId = customer.userId;
  if (!userId) {
    if (await prisma.user.findUnique({ where: { email: customer.email } })) throw conflict('A user with this email already exists');
    const user = await prisma.user.create({
      data: {
        name: customer.name,
        email: customer.email,
        role: 'CUSTOMER',
        phone: customer.phone,
        passwordHash: await hashPassword(`${crypto.randomUUID()}Aa!`),
      },
    });
    await prisma.customer.update({ where: { id }, data: { userId: user.id } });
    userId = user.id;
  }
  await sendPasswordLink(userId, 'invite');
  await audit({ actorId: req.user!.id, action: 'CUSTOMER_INVITED', entityType: 'Customer', entityId: id, ip: req.ip });
  res.json({ data: { message: `Portal invitation sent to ${customer.email}` } });
});
