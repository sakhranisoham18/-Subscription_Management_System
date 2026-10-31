import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from './prisma';

export interface AuditInput {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: Prisma.InputJsonValue;
  ip?: string | null;
}

/** Writes an audit-log entry (inside the caller's transaction when one is given). */
export async function audit(input: AuditInput, tx: Tx = prisma) {
  await tx.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      details: input.details,
      ip: input.ip ?? null,
    },
  });
}
