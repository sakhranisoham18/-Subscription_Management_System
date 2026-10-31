import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { idParam, orderBy, pageArgs, pageMeta, paginationQuery, parse } from '../../lib/http';
import { conflict, notFound, unprocessable } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { hashPassword } from '../../lib/tokens';
import { requirePermission } from '../../middleware/auth';
import { normalizeEmail, passwordProblems } from '../../domain/password';
import { sendPasswordLink } from '../auth/auth.routes';

/** Staff & admin account management — ADMIN ONLY (only the admin can add a new member of staff). */
export const usersRouter = Router();
usersRouter.use(requirePermission('users:manage'));

const select = { id: true, name: true, email: true, role: true, status: true, phone: true, lastLoginAt: true, createdAt: true } as const;

usersRouter.get('/', async (req, res) => {
  const q = parse(
    paginationQuery.extend({ role: z.enum(['ADMIN', 'STAFF']).optional(), status: z.enum(['ACTIVE', 'INACTIVE']).optional() }),
    req.query,
  );
  const where: Prisma.UserWhereInput = {
    role: q.role ?? { in: ['ADMIN', 'STAFF'] },
    status: q.status,
    ...(q.search ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search, mode: 'insensitive' } }] } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({ where, select, orderBy: orderBy(q, ['name', 'email', 'createdAt', 'lastLoginAt'] as const, 'createdAt'), ...pageArgs(q) }),
  ]);
  res.json({ data: items, meta: pageMeta(q, total) });
});

usersRouter.post('/', async (req, res) => {
  const body = parse(
    z.object({
      name: z.string().trim().min(2).max(120),
      email: z.string().trim().email().transform(normalizeEmail),
      role: z.enum(['ADMIN', 'STAFF']),
      phone: z.string().trim().max(30).optional().nullable(),
      password: z
        .string()
        .optional()
        .superRefine((p, ctx) => {
          if (p) for (const message of passwordProblems(p)) ctx.addIssue({ code: 'custom', message });
        }),
      sendInvite: z.boolean().default(true),
    }),
    req.body,
  );
  if (await prisma.user.findUnique({ where: { email: body.email } })) {
    throw conflict('An account with this email already exists', { fields: { email: 'Email already in use' } });
  }
  if (!body.password && !body.sendInvite) throw unprocessable('Set a password or send an invite link');
  // If no password is given, a random unusable one is set and the user receives a set-password link.
  const passwordHash = await hashPassword(body.password ?? `${crypto.randomUUID()}Aa!`);
  const user = await prisma.user.create({
    data: { name: body.name, email: body.email, role: body.role, phone: body.phone ?? null, passwordHash },
    select,
  });
  let warning: string | undefined;
  if (body.sendInvite) {
    try {
      await sendPasswordLink(user.id, 'invite');
    } catch {
      warning = 'Account created, but the invitation email could not be sent. Use “Send password reset” to retry.';
    }
  }
  await audit({ actorId: req.user!.id, action: 'STAFF_CREATED', entityType: 'User', entityId: user.id, details: { role: body.role }, ip: req.ip });
  res.status(201).json({ data: user, ...(warning ? { warning } : {}) });
});

usersRouter.patch('/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const body = parse(
    z.object({
      name: z.string().trim().min(2).max(120).optional(),
      role: z.enum(['ADMIN', 'STAFF']).optional(),
      status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
      phone: z.string().trim().max(30).nullable().optional(),
    }),
    req.body,
  );
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing || existing.role === 'CUSTOMER') throw notFound('Staff member');
  if (id === req.user!.id && (body.status === 'INACTIVE' || (body.role && body.role !== 'ADMIN'))) {
    throw unprocessable('You cannot deactivate or demote your own account');
  }
  if ((body.status === 'INACTIVE' || body.role === 'STAFF') && existing.role === 'ADMIN') {
    const admins = await prisma.user.count({ where: { role: 'ADMIN', status: 'ACTIVE' } });
    if (admins <= 1) throw unprocessable('At least one active admin is required');
  }
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({ where: { id }, data: body, select });
    if (body.status === 'INACTIVE') {
      await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await audit({ actorId: req.user!.id, action: 'STAFF_UPDATED', entityType: 'User', entityId: id, details: body, ip: req.ip }, tx);
    return u;
  });
  res.json({ data: user });
});

usersRouter.post('/:id/send-reset', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.role === 'CUSTOMER') throw notFound('Staff member');
  await sendPasswordLink(id, 'reset');
  await audit({ actorId: req.user!.id, action: 'STAFF_RESET_SENT', entityType: 'User', entityId: id, ip: req.ip });
  res.json({ data: { message: 'Password reset link sent' } });
});
