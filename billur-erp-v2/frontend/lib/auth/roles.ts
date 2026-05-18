/** Roles that use the isolated worker portal (no admin dashboard). */
export const WORKER_PORTAL_ROLES = new Set([
  'worker',
  'cutting',
  'printing',
  'sewing',
  'quality',
  'ironing',
  'packing',
]);

export const ADMIN_ROLES = new Set(['owner', 'admin', 'warehouse', 'boxing']);

export function isWorkerPortalRole(roleId: string | undefined): boolean {
  if (!roleId) return false;
  if (roleId === 'owner' || roleId === 'admin') return false;
  return WORKER_PORTAL_ROLES.has(roleId);
}

export function getDefaultRoute(roleId: string | undefined): string {
  if (!roleId) return '/login';
  if (roleId === 'boxing') return '/boxui';
  if (isWorkerPortalRole(roleId)) return '/worker';
  return '/dashboard';
}
