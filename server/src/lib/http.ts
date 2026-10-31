import { z, type ZodType } from 'zod';
import { badRequest } from './errors';

/** Parses input with a Zod schema and throws a 400 with field-level details on failure. */
export function parse<T extends ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      if (!fields[key]) fields[key] = issue.message;
    }
    throw badRequest('Please check the highlighted fields', { fields });
  }
  return result.data;
}

export const idParam = z.object({ id: z.string().uuid('Invalid id') });

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  sort: z.string().max(40).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export type Pagination = z.infer<typeof paginationQuery>;

export function pageArgs(p: Pagination) {
  return { skip: (p.page - 1) * p.pageSize, take: p.pageSize };
}

export function pageMeta(p: Pagination, total: number) {
  return { page: p.page, pageSize: p.pageSize, total, totalPages: Math.max(1, Math.ceil(total / p.pageSize)) };
}

/** Picks a whitelisted sort column (prevents arbitrary orderBy injection). */
export function orderBy<T extends string>(p: Pagination, allowed: readonly T[], fallback: T) {
  const field = (allowed as readonly string[]).includes(p.sort ?? '') ? (p.sort as T) : fallback;
  return { [field]: p.order } as Record<T, 'asc' | 'desc'>;
}

export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date');

/** Optional date: '' / null → null (clears the value); undefined stays undefined (field untouched on PATCH). */
export const optionalDateString = z
  .union([dateString, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === undefined ? undefined : v ? v : null));

export const money = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), 'Enter a non-negative amount with up to 2 decimals');

export const percent = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d+(\.\d{1,4})?$/.test(v) && Number(v) <= 100, 'Enter a percentage between 0 and 100');

export const optionalText = (max = 2000) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v === undefined ? undefined : v ? v : null));

export const optionalUuid = z
  .union([z.string().uuid(), z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === undefined ? undefined : v ? v : null));
