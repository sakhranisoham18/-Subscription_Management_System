import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { forbidden, unauthorized } from '../lib/errors';
import { hasPermission, type Permission, type Role } from '../domain/permissions';

export interface AuthUser {
  id: string;
  role: Role;
  name: string;
  email: string;
  customerId: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

interface AccessPayload {
  sub: string;
  role: Role;
  typ: 'access';
}

export function signAccessToken(user: { id: string; role: Role }) {
  return jwt.sign({ sub: user.id, role: user.role, typ: 'access' } satisfies AccessPayload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'],
    issuer: 'brightloop-sms',
  });
}

/**
 * Verifies the Bearer access token, then re-loads the user so that deactivated accounts and
 * role changes take effect immediately (the role in the token is never trusted on its own).
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(unauthorized());
  let payload: AccessPayload;
  try {
    payload = jwt.verify(header.slice(7), env.JWT_ACCESS_SECRET, { issuer: 'brightloop-sms' }) as AccessPayload;
  } catch {
    return next(unauthorized('Your session has expired. Please sign in again.'));
  }
  if (payload.typ !== 'access') return next(unauthorized());
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, role: true, name: true, email: true, status: true, customer: { select: { id: true } } },
  });
  if (!user || user.status !== 'ACTIVE') return next(unauthorized('Your account is not active'));
  req.user = { id: user.id, role: user.role, name: user.name, email: user.email, customerId: user.customer?.id ?? null };
  next();
}

export const requirePermission =
  (...permissions: Permission[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    const ok = permissions.every((p) => hasPermission(req.user!.role, p));
    return ok ? next() : next(forbidden());
  };

/** Customer-portal guard: the caller must be a customer linked to a customer record. */
export function requireCustomer(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'CUSTOMER' || !req.user.customerId) return next(forbidden('Customer portal only'));
  next();
}

export function currentCustomerId(req: Request): string {
  if (!req.user?.customerId) throw forbidden('Customer portal only');
  return req.user.customerId;
}
