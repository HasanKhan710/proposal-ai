import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const secretKey = process.env.JWT_SECRET || 'super_secret_jwt_string_change_me_in_prod';
const key = new TextEncoder().encode(secretKey);

async function verifySession(request: NextRequest) {
  const sessionCookie = request.cookies.get('session')?.value;
  if (!sessionCookie) return null;
  try {
    const { payload } = await jwtVerify(sessionCookie, key, { algorithms: ['HS256'] });
    return payload;
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Public routes
  if (path === '/login' || path.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  // Validate session
  const session = await verifySession(request);

  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Admin-only routes
  if (path.startsWith('/admin') || path.startsWith('/api/admin') || path.startsWith('/api/knowledge-base')) {
    if (session.role !== 'admin') {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }

  // Rewrite / to /dashboard
  if (path === '/') {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
