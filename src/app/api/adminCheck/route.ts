// POST /api/adminCheck - second factor for the admin panel.
// Validates the session, re-checks the DB role, then compares the submitted
// password to ADMIN_PASSWORD on the server. The password never reaches the client.

import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { authenticate, isAdmin } from '@/lib/server/auth';
import { fail, json, parseBody } from '@/lib/server/http';
import { checkRateLimit } from '@/lib/server/rateLimit';

const schema = z.object({ password: z.string().min(1).max(1024) });

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function POST(request: Request) {
  try {
    const body = await parseBody(request, schema, 'Missing credentials');
    if (!body.ok) return body.response;

    const caller = await authenticate(request);
    if (!caller) return fail('Session invalid or expired', 401);
    if (!(await isAdmin(caller))) return fail('Not authorized', 403);

    // Slow down guessing of the panel password (10 tries / 15 min per admin).
    const limit = await checkRateLimit(request, { email: `admin:${caller.userId}`, attempts: 10 });
    if (!limit.allowed) {
      return json(
        { error: 'Too many attempts. Please try again later.', retryAfter: limit.retryAfter },
        429,
        { 'Retry-After': String(limit.retryAfter) },
      );
    }

    const secret = process.env.ADMIN_PASSWORD ?? '';
    const authorized = secret.length > 0 && safeEqual(body.data.password, secret);
    return json({ authorized });
  } catch (err) {
    console.error('adminCheck unexpected error:', err);
    return fail('Verification service error', 500);
  }
}
