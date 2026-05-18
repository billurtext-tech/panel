import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const ADMIN_ONLY_PREFIXES = [
  '/dashboard/clients', '/dashboard/orders', '/dashboard/users', '/dashboard/payroll',
  '/dashboard/piece-rates', '/dashboard/reports', '/dashboard/audit',
  '/dashboard/boxapp-sync', '/dashboard/inventory', '/dashboard/surplus',
];

const WORKER_PREFIX = '/worker';
const BOXUI_PREFIX = '/boxui';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Static assets and API proxy — skip
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/uploads') ||
    pathname === '/login' ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get('token')?.value;
  if (!token && pathname !== '/login') {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
