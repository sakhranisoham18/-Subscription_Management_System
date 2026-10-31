import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { idParam, optionalText, parse, percent } from '../../lib/http';
import { notFound } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { requirePermission } from '../../middleware/auth';

/** Tax rules — configured by the admin; quotation/subscription/invoice lines reference them. */
export const taxesRouter = Router();

const fields = z.object({
  name: z.string().trim().min(2).max(80),
  rate: percent,
  description: optionalText(300),
  isDefault: z.boolean().optional(),
});

taxesRouter.get('/', requirePermission('taxes:read'), async (req, res) => {
  const q = parse(z.object({ status: z.enum(['ACTIVE', 'ARCHIVED']).optional() }), req.query);
  const items = await prisma.taxRule.findMany({ where: { status: q.status }, orderBy: [{ status: 'asc' }, { rate: 'asc' }] });
  res.json({ data: items });
});

taxesRouter.post('/', requirePermission('taxes:write'), async (req, res) => {
  const body = parse(fields, req.body);
  const tax = await prisma.$transaction(async (tx) => {
    if (body.isDefault) await tx.taxRule.updateMany({ data: { isDefault: false } });
    const t = await tx.taxRule.create({ data: body });
    await audit({ actorId: req.user!.id, action: 'TAX_CREATED', entityType: 'TaxRule', entityId: t.id, details: { rate: body.rate } }, tx);
    return t;
  });
  res.status(201).json({ data: tax });
});

taxesRouter.patch('/:id', requirePermission('taxes:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const body = parse(fields.partial().extend({ status: z.enum(['ACTIVE', 'ARCHIVED']).optional() }), req.body);
  if (!(await prisma.taxRule.findUnique({ where: { id } }))) throw notFound('Tax rule');
  const tax = await prisma.$transaction(async (tx) => {
    if (body.isDefault) await tx.taxRule.updateMany({ where: { NOT: { id } }, data: { isDefault: false } });
    const t = await tx.taxRule.update({ where: { id }, data: { ...body, ...(body.status === 'ARCHIVED' ? { isDefault: false } : {}) } });
    await audit({ actorId: req.user!.id, action: 'TAX_UPDATED', entityType: 'TaxRule', entityId: id, details: body }, tx);
    return t;
  });
  res.json({ data: tax });
});
