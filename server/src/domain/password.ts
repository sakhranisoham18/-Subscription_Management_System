/**
 * Password policy from the brief: more than eight characters, with at least one uppercase letter,
 * one lowercase letter and one special character.
 */
export const PASSWORD_RULES = [
  { test: (p: string) => p.length > 8, message: 'Password must be more than 8 characters long' },
  { test: (p: string) => /[A-Z]/.test(p), message: 'Password must contain an uppercase letter' },
  { test: (p: string) => /[a-z]/.test(p), message: 'Password must contain a lowercase letter' },
  { test: (p: string) => /[^A-Za-z0-9]/.test(p), message: 'Password must contain a special character' },
  { test: (p: string) => p.length <= 128, message: 'Password must be at most 128 characters long' },
];

export function passwordProblems(password: string): string[] {
  return PASSWORD_RULES.filter((r) => !r.test(password)).map((r) => r.message);
}

export function isStrongPassword(password: string): boolean {
  return passwordProblems(password).length === 0;
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
