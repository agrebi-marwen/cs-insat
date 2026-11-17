import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Runs before every page request:
//   1. builds a per-request Content-Security-Policy with a script nonce
//   2. refreshes the Supabase session cookies so Server Components and the
//      browser client always see a valid access token

function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV !== 'production';
  const supabaseOrigin = (() => {
    try {
      return new URL(process.env.SUPABASE_URL ?? '').origin;
    } catch {
      return 'https://*.supabase.co';
    }
  })();
  const supabaseWs = supabaseOrigin.replace(/^http/, 'ws');

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob:",
    `connect-src 'self' ${supabaseOrigin} ${supabaseWs}${isDev ? ' ws: http://localhost:*' : ''}`,
    'frame-src https://drive.google.com',
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp(nonce);

  // Rebuilt whenever Supabase rotates cookies so the page render sees them.
  const makeResponse = () => {
    const headers = new Headers(request.headers);
    headers.set('x-nonce', nonce);
    headers.set('Content-Security-Policy', csp);
    const res = NextResponse.next({ request: { headers } });
    res.headers.set('Content-Security-Policy', csp);
    return res;
  };

  let response = makeResponse();

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const hasSession = request.cookies.getAll().some((c) => c.name.startsWith('sb-'));

  if (url && anonKey && hasSession) {
    const supabase = createServerClient(url.replace(/\/+$/, '').replace(/\/rest\/v1$/i, ''), anonKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = makeResponse();
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
        },
      },
    });
    try {
      // Validates the token and refreshes it when it is close to expiry.
      await supabase.auth.getClaims();
    } catch {
      // Auth outage: let the request through; page guards decide what to do.
    }
  }

  return response;
}

export const config = {
  matcher: [
    // Pages only: skip API routes, Next internals, static assets and prefetches.
    {
      source: '/((?!api|_next/static|_next/image|assets|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt)$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
