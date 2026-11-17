// POST /api/authLogin - rate-limited sign-in.
// The password grant runs on the server so the limit cannot be bypassed from
// the browser. On success the session is written to cookies, which both the
// server (route guards) and the browser Supabase client read.

import { z } from 'zod';
import { fail, json, parseBody } from '@/lib/server/http';
import { checkRateLimit } from '@/lib/server/rateLimit';
import { createSessionClient } from '@/lib/supabase/server';

const schema = z.object({
  email: z.string().trim().toLowerCase().min(1).max(320),
  password: z.string().min(1).max(1024),
});

export async function POST(request: Request) {
  try {
    const body = await parseBody(request, schema, 'Email and password are required');
    if (!body.ok) return body.response;
    const { email, password } = body.data;

    const limit = await checkRateLimit(request, { email });
    if (!limit.allowed) {
      return json(
        { error: 'Too many attempts. Please try again later.', retryAfter: limit.retryAfter },
        429,
        { 'Retry-After': String(limit.retryAfter) },
      );
    }

    const supabase = await createSessionClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      return fail(error?.message || 'Invalid login credentials', 401);
    }

    return json({ ok: true });
  } catch (err) {
    console.error('authLogin unexpected error:', err);
    return fail('Authentication service error', 500);
  }
}
