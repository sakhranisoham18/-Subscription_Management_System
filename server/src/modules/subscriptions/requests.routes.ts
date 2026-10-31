import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { idParam, optionalText, pageArgs, pageMeta, paginationQuery, parse } from '../../lib/http';
import { notFound, unprocessable } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { requirePermission } from '../../middleware/auth';
import { closeSubscription, pauseSubscription, renewSubscription, resumeSubscription } from '../../services/subscriptions';
import { sendEmail } from '../../services/email';

/** Customer change requests (pause / resume / renew / cancel) reviewed by staff. */
export const requestsRouter = Router();
requestsRouter.use(requirePermission('requests:manage'));

requestsRouter.get('/', async (req, res) => {
  const q = parse(paginationQuery.extend({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional() }), req.query);
  const where = { status: q.status };
  const [total, items, pending] = await Promise.all([
    prisma.changeRequest.count({ where }),
    prisma.changeRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...pageArgs(q),
      include: {
        subscription: { select: { id: true, number: true, status: true, plan: { select: { name: true } } } },
        customer: { select: { id: true, name: true, companyName: true } },
        reviewedBy: { select: { name: true } },
      },
    }),
    prisma.changeRequest.count({ where: { status: 'PENDING' } }),
  ]);
  res.json({ data: items, meta: { ...pageMeta(q, total), pending } });
});

requestsRouter.post('/:id/review', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const body = parse(z.object({ decision: z.enum(['APPROVED', 'REJECTED']), response: optionalText(500) }), req.body);
  const cr = await prisma.changeRequest.findUnique({ where: { id }, include: { customer: true, subscription: true } });
  if (!cr) throw notFound('Request');
  if (cr.status !== 'PENDING') throw unprocessable('This request has already been reviewed');

  if (body.decision === 'APPROVED') {
    const actor = req.user!.id;
    const note = `Customer request approved${body.response ? `: ${body.response}` : ''}`;
    // The lifecycle service enforces the same plan rules as a staff action would.
    switch (cr.type) {
      case 'PAUSE':
        await pauseSubscription(cr.subscriptionId, actor, note);
        break;
      case 'RESUME':
        await resumeSubscription(cr.subscriptionId, actor);
        break;
      case 'RENEW':
        await renewSubscription(cr.subscriptionId, actor);
        break;
      case 'CANCEL':
        await closeSubscription(cr.subscriptionId, actor, note);
        break;
    }
  }
  const updated = await prisma.changeRequest.update({
    where: { id },
    data: { status: body.decision, response: body.response ?? null, reviewedById: req.user!.id, reviewedAt: new Date() },
  });
  await audit({ actorId: req.user!.id, action: `CHANGE_REQUEST_${body.decision}`, entityType: 'Subscription', entityId: cr.subscriptionId, details: { type: cr.type } });
  await sendEmail({
    to: cr.customer.email,
    subject: `Your ${cr.type.toLowerCase()} request for ${cr.subscription.number} was ${body.decision.toLowerCase()}`,
    text: `Hello ${cr.customer.name},\n\nYour request to ${cr.type.toLowerCase()} subscription ${cr.subscription.number} has been ${body.decision.toLowerCase()}.${body.response ? `\n\nNote from our team: ${body.response}` : ''}\n\nBrightloop Software`,
  }).catch(() => undefined);
  res.json({ data: updated });
});
