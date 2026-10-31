import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { parse } from '../../lib/http';
import { badRequest, conflict, forbidden, unauthorized } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { DUMMY_HASH, hashPassword, randomToken, sha256, verifyPassword } from '../../lib/tokens';
import { authenticate, signAccessToken } from '../../middleware/auth';
import { loginLimiter, sensitiveLimiter } from '../../middleware/rateLimit';
import { normalizeEmail, passwordProblems } from '../../domain/password';
import { permissionsFor } from '../../domain/permissions';
import { sendEmail } from '../../services/email';
import { getSettings } from '../../lib/settings';
import { logger } from '../../lib/logger';

export const authRouter = Router();

const REFRESH_COOKIE = 'bl_refresh';
const RESET_TOKEN_MINUTES = 30;

const strongPassword = z.string().superRefine((p, ctx) => {
  for (const message of passwordProblems(p)) ctx.addIssue({ code: 'custom', message });
});
const email = z.string().trim().max(254).email('Enter a valid email address').transform(normalizeEmail);

function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE || env.COOKIE_SAMESITE === 'none',
    sameSite: env.COOKIE_SAMESITE,
    path: '/api/v1/auth',
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
  } as const;
}

/** CSRF defence for cookie-authenticated endpoints: reject cross-site Origins. */
function assertSameOrigin(req: Request) {
  const origin = req.headers.origin;
  if (origin && !env.clientOrigins.includes(origin)) throw forbidden('Request origin not allowed');
}

async function issueSession(res: Response, req: Request, user: { id: string; role: 'ADMIN' | 'STAFF' | 'CUSTOMER' }) {
  const refresh = randomToken();
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(refresh),
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
      userAgent: req.headers['user-agent']?.slice(0, 200),
    },
  });
  res.cookie(REFRESH_COOKIE, refresh, cookieOptions());
  return signAccessToken(user);
}

async function profile(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      phone: true,
      status: true,
      createdAt: true,
      lastLoginAt: true,
      customer: { select: { id: true, companyName: true, name: true } },
    },
  });
  return { ...user, permissions: permissionsFor(user.role) };
}

// POST /auth/register — public customer self-registration
authRouter.post('/register', sensitiveLimiter, async (req, res) => {
  const body = parse(
    z.object({
      name: z.string().trim().min(2, 'Enter your name').max(120),
      email,
      password: strongPassword,
      companyName: z.string().trim().max(160).optional().transform((v) => v || null),
      phone: z.string().trim().max(30).optional().transform((v) => v || null),
    }),
    req.body,
  );
  const taken = await Promise.all([
    prisma.user.findUnique({ where: { email: body.email }, select: { id: true } }),
    prisma.customer.findUnique({ where: { email: body.email }, select: { id: true } }),
  ]);
  if (taken.some(Boolean)) {
    throw conflict('An account with this email already exists', { fields: { email: 'This email is already registered' } });
  }
  const passwordHash = await hashPassword(body.password);
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: { name: body.name, email: body.email, passwordHash, role: 'CUSTOMER', phone: body.phone, lastLoginAt: new Date() },
    });
    await tx.customer.create({
      data: { userId: u.id, name: body.name, companyName: body.companyName, email: body.email, phone: body.phone },
    });
    await audit({ actorId: u.id, action: 'REGISTER', entityType: 'User', entityId: u.id, ip: req.ip }, tx);
    return u;
  });
  const accessToken = await issueSession(res, req, user);
  res.status(201).json({ data: { accessToken, user: await profile(user.id) } });
});

// POST /auth/login
authRouter.post('/login', loginLimiter, async (req, res) => {
  const body = parse(z.object({ email, password: z.string().min(1, 'Enter your password').max(200) }), req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  const ok = await verifyPassword(body.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) {
    await audit({ action: 'LOGIN_FAILED', entityType: 'User', entityId: user?.id ?? null, details: { email: body.email }, ip: req.ip });
    throw unauthorized('Incorrect email or password');
  }
  if (user.status !== 'ACTIVE') throw unauthorized('This account has been deactivated. Contact your administrator.');
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const accessToken = await issueSession(res, req, user);
  await audit({ actorId: user.id, action: 'LOGIN', entityType: 'User', entityId: user.id, ip: req.ip });
  res.json({ data: { accessToken, user: await profile(user.id) } });
});

// POST /auth/refresh — rotates the refresh token (httpOnly cookie) and returns a new access token
authRouter.post('/refresh', async (req, res) => {
  assertSameOrigin(req);
  const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (!token) throw unauthorized('No active session');
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!stored) {
    res.clearCookie(REFRESH_COOKIE, { ...cookieOptions(), maxAge: undefined });
    throw unauthorized('Session expired');
  }
  if (stored.revokedAt) {
    // Re-use of a rotated token → possible theft: revoke every session for this user.
    await prisma.refreshToken.updateMany({ where: { userId: stored.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit({ actorId: stored.userId, action: 'REFRESH_TOKEN_REUSE', entityType: 'User', entityId: stored.userId, ip: req.ip });
    res.clearCookie(REFRESH_COOKIE, { ...cookieOptions(), maxAge: undefined });
    throw unauthorized('Session expired');
  }
  if (stored.expiresAt < new Date() || stored.user.status !== 'ACTIVE') {
    res.clearCookie(REFRESH_COOKIE, { ...cookieOptions(), maxAge: undefined });
    throw unauthorized('Session expired');
  }
  const next = randomToken();
  await prisma.$transaction([
    prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date(), replacedBy: sha256(next) } }),
    prisma.refreshToken.create({
      data: {
        userId: stored.userId,
        tokenHash: sha256(next),
        expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
        userAgent: req.headers['user-agent']?.slice(0, 200),
      },
    }),
  ]);
  res.cookie(REFRESH_COOKIE, next, cookieOptions());
  res.json({ data: { accessToken: signAccessToken(stored.user), user: await profile(stored.userId) } });
});

// POST /auth/logout
authRouter.post('/logout', async (req, res) => {
  assertSameOrigin(req);
  const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (token) {
    await prisma.refreshToken.updateMany({ where: { tokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }
  res.clearCookie(REFRESH_COOKIE, { ...cookieOptions(), maxAge: undefined });
  res.json({ data: { ok: true } });
});

const GENERIC_RESET_MESSAGE = 'If an account exists for that email, a password reset link has been sent.';

// POST /auth/forgot-password — never reveals whether the email exists
authRouter.post('/forgot-password', sensitiveLimiter, async (req, res) => {
  const body = parse(z.object({ email }), req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  if (user && user.status === 'ACTIVE') {
    try {
      await sendPasswordLink(user.id, 'reset');
      await audit({ actorId: user.id, action: 'PASSWORD_RESET_REQUESTED', entityType: 'User', entityId: user.id, ip: req.ip });
    } catch (err) {
      // Delivery problems must not change the response (otherwise status codes would reveal which emails have accounts).
      logger.error({ err, userId: user.id }, 'Password-reset email failed');
    }
  }
  res.json({ data: { message: GENERIC_RESET_MESSAGE } });
});

/** Creates a single-use, time-limited token (only its SHA-256 is stored) and emails the link. */
export async function sendPasswordLink(userId: string, kind: 'reset' | 'invite') {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const token = randomToken(32);
  const minutes = kind === 'invite' ? 60 * 24 * 3 : RESET_TOKEN_MINUTES;
  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.passwordResetToken.create({
      data: { userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + minutes * 60_000) },
    }),
  ]);
  const settings = await getSettings();
  const link = `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  await sendEmail({
    to: user.email,
    sensitive: true,
    subject:
      kind === 'invite'
        ? `You're invited to the ${settings.companyName} customer portal`
        : `Reset your ${settings.companyName} password`,
    text:
      kind === 'invite'
        ? `Hello ${user.name},\n\nAn account has been created for you on the ${settings.companyName} portal.\nSet your password using this link (valid for 3 days):\n\n${link}\n\nIf you were not expecting this email you can ignore it.`
        : `Hello ${user.name},\n\nWe received a request to reset your password. Use this link within ${RESET_TOKEN_MINUTES} minutes:\n\n${link}\n\nIf you did not request this, you can safely ignore this email — your password will not change.`,
  });
}

// POST /auth/reset-password
authRouter.post('/reset-password', sensitiveLimiter, async (req, res) => {
  const body = parse(z.object({ token: z.string().min(20).max(200), password: strongPassword }), req.body);
  const stored = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(body.token) } });
  if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
    throw badRequest('This reset link is invalid or has expired. Please request a new one.');
  }
  const passwordHash = await hashPassword(body.password);
  await prisma.$transaction([
    prisma.user.update({ where: { id: stored.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: stored.id }, data: { usedAt: new Date() } }),
    prisma.refreshToken.updateMany({ where: { userId: stored.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  await audit({ actorId: stored.userId, action: 'PASSWORD_RESET', entityType: 'User', entityId: stored.userId, ip: req.ip });
  res.json({ data: { message: 'Your password has been updated. You can now sign in.' } });
});

// GET /auth/me
authRouter.get('/me', authenticate, async (req, res) => {
  res.json({ data: await profile(req.user!.id) });
});

// PATCH /auth/me — name / phone
authRouter.patch('/me', authenticate, async (req, res) => {
  const body = parse(
    z.object({
      name: z.string().trim().min(2).max(120).optional(),
      phone: z.string().trim().max(30).nullable().optional(),
    }),
    req.body,
  );
  await prisma.user.update({ where: { id: req.user!.id }, data: body });
  res.json({ data: await profile(req.user!.id) });
});

// POST /auth/change-password
authRouter.post('/change-password', authenticate, sensitiveLimiter, async (req, res) => {
  const body = parse(z.object({ currentPassword: z.string().min(1), newPassword: strongPassword }), req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
    throw badRequest('Current password is incorrect', { fields: { currentPassword: 'Current password is incorrect' } });
  }
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(body.newPassword) } });
  await audit({ actorId: user.id, action: 'PASSWORD_CHANGED', entityType: 'User', entityId: user.id, ip: req.ip });
  res.json({ data: { message: 'Password updated' } });
});
