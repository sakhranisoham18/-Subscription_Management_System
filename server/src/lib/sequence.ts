import type { Tx } from './prisma';

const PREFIX: Record<string, string> = { QT: 'QT', SUB: 'SUB', INV: 'INV', PAY: 'PAY' };

/**
 * Atomically issues the next document number (e.g. INV-2026-000123).
 * Uses INSERT … ON CONFLICT … RETURNING so concurrent transactions never receive the same number.
 */
export async function nextNumber(tx: Tx, key: keyof typeof PREFIX, year = new Date().getUTCFullYear()): Promise<string> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "Sequence" ("key", "value") VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "Sequence"."value" + 1
    RETURNING "value"`;
  const value = Number(rows[0].value);
  return `${PREFIX[key]}-${year}-${String(value).padStart(6, '0')}`;
}
