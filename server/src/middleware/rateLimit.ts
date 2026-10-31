import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

// Rate limiting is off under test, except in the suite that sets RATE_LIMIT_TEST=on to verify it.
const skip = () => env.isTest && process.env.RATE_LIMIT_TEST !== 'on';

/** Brute-force protection for login. */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Try again in 15 minutes.' } },
});

/** Password-reset / registration abuse protection. */
export const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a few minutes and try again.' } },
});

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip,
});
