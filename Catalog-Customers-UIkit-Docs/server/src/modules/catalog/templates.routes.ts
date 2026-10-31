import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { idParam, optionalText, optionalUuid, parse } from '../../lib/http';
import { notFound, unprocessable } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { requirePermission } from '../../middleware/auth';

/** Quotation templates: reusable plan, standard lines, validity days and terms. */
export const templatesRouter = Router();

const templateLine = z.discriminatedUnion('type', [
  z.object({ type: z.literal('PLAN'), quantity: z.coerce.number().int().min(1), taxRuleId: optionalUuid }),
  z.object({
    type: z.literal('PRODUCT'),
    productId: z.string().uuid(),
    variantId: optionalUuid,
    quantity: z.coerce.number().int().min(1),
    taxRuleId: optionalUuid,
  }),
]);

const fields = z.object({
  name: z.string().trim().min(2).max(120),
  description: optionalText(500),
  validityDays: z.coerce.number().int().min(1).max(365),
  planId: z.string().uuid('Select the plan this template is for'),
  terms: optionalText(4000),
  notes: optionalText(2000),
  lines: z.array(templateLine).min(1, 'Add at least one line').max(50),
});

const include = {
  plan: { select: { id: true, name: true, billingFrequency: true, price: true, minQuantity: true } },
  lines: {
    orderBy: { sortOrder: 'asc' as const },
    include: {
      product: { select: { id: true, name: true, salesPrice: true, status: true } },
      variant: { select: { id: true, name: true, attribute: true, priceAdjustment: true, status: true } },
      taxRule: { select: { id: true, name: true, rate: true } },
    },
  },
};

async function validate(body: Partial<z.infer<typeof fields>>) {
  if (body.planId) {
    const plan = await prisma.subscriptionPlan.findUnique({ where: { id: body.planId } });
    if (!plan) throw unprocessable('Plan not found');
    for (const l of body.lines ?? []) {
      if (l.type === 'PLAN' && l.quantity < plan.minQuantity) throw unprocessable(`Plan requires a minimum quantity of ${plan.minQuantity}`);
    }
  }
  for (const l of body.lines ?? []) {
    if (l.type === 'PRODUCT' && l.variantId) {
      const v = await prisma.productVariant.findFirst({ where: { id: l.variantId, productId: l.productId } });
      if (!v) throw unprocessable('Variant does not belong to the selected product');
    }
  }
}

const lineRows = (lines: z.infer<typeof templateLine>[], planId: string) =>
  lines.map((l, i) => ({
    planId: l.type === 'PLAN' ? planId : null,
    productId: l.type === 'PRODUCT' ? l.productId : null,
    variantId: l.type === 'PRODUCT' ? l.variantId ?? null : null,
    quantity: l.quantity,
    taxRuleId: l.taxRuleId ?? null,
    sortOrder: i,
  }));

templatesRouter.get('/', requirePermission('templates:read'), async (req, res) => {
  const q = parse(z.object({ status: z.enum(['ACTIVE', 'ARCHIVED']).optional() }), req.query);
  res.json({ data: await prisma.quotationTemplate.findMany({ where: { status: q.status }, include, orderBy: { name: 'asc' } }) });
});

templatesRouter.get('/:id', requirePermission('templates:read'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const t = await prisma.quotationTemplate.findUnique({ where: { id }, include });
  if (!t) throw notFound('Template');
  res.json({ data: t });
});

templatesRouter.post('/', requirePermission('templates:write'), async (req, res) => {
  const body = parse(fields, req.body);
  await validate(body);
  const { lines, ...rest } = body;
  const t = await prisma.quotationTemplate.create({ data: { ...rest, lines: { create: lineRows(lines, body.planId) } }, include });
  await audit({ actorId: req.user!.id, action: 'TEMPLATE_CREATED', entityType: 'QuotationTemplate', entityId: t.id });
  res.status(201).json({ data: t });
});

templatesRouter.patch('/:id', requirePermission('templates:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const existing = await prisma.quotationTemplate.findUnique({ where: { id } });
  if (!existing) throw notFound('Template');
  const body = parse(fields.partial().extend({ status: z.enum(['ACTIVE', 'ARCHIVED']).optional() }), req.body);
  const planId = body.planId ?? existing.planId!;
  await validate({ ...body, planId });
  const { lines, ...rest } = body;
  const t = await prisma.$transaction(async (tx) => {
    if (lines) {
      await tx.quotationTemplateLine.deleteMany({ where: { templateId: id } });
      await tx.quotationTemplateLine.createMany({ data: lineRows(lines, planId).map((l) => ({ ...l, templateId: id })) });
    }
    return tx.quotationTemplate.update({ where: { id }, data: rest, include });
  });
  await audit({ actorId: req.user!.id, action: 'TEMPLATE_UPDATED', entityType: 'QuotationTemplate', entityId: id });
  res.json({ data: t });
});
