export type Role = 'ADMIN' | 'STAFF' | 'CUSTOMER';

/**
 * Permission matrix (single source of truth — enforced by `requirePermission` on every route
 * and mirrored to the client only to hide controls). See docs/permission-matrix.md.
 */
export const PERMISSIONS = {
  'dashboard:view': ['ADMIN', 'STAFF'],
  'customers:read': ['ADMIN', 'STAFF'],
  'customers:write': ['ADMIN', 'STAFF'],
  'products:read': ['ADMIN', 'STAFF'],
  'products:write': ['ADMIN'],
  'plans:read': ['ADMIN', 'STAFF'],
  'plans:write': ['ADMIN'],
  'taxes:read': ['ADMIN', 'STAFF'],
  'taxes:write': ['ADMIN'],
  'discounts:read': ['ADMIN', 'STAFF'],
  'discounts:write': ['ADMIN'],
  'templates:read': ['ADMIN', 'STAFF'],
  'templates:write': ['ADMIN', 'STAFF'],
  'quotations:read': ['ADMIN', 'STAFF'],
  'quotations:write': ['ADMIN', 'STAFF'],
  'subscriptions:read': ['ADMIN', 'STAFF'],
  'subscriptions:write': ['ADMIN', 'STAFF'],
  'requests:manage': ['ADMIN', 'STAFF'],
  'invoices:read': ['ADMIN', 'STAFF'],
  'invoices:write': ['ADMIN', 'STAFF'],
  'payments:read': ['ADMIN', 'STAFF'],
  'payments:write': ['ADMIN', 'STAFF'],
  'payments:void': ['ADMIN'],
  'billing:run': ['ADMIN', 'STAFF'],
  'reports:view': ['ADMIN'],
  'users:manage': ['ADMIN'],
  'settings:manage': ['ADMIN'],
  'audit:view': ['ADMIN'],
  'portal:access': ['CUSTOMER'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function hasPermission(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export function permissionsFor(role: Role): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => hasPermission(role, p));
}
