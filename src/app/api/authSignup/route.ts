// POST /api/authSignup - rate-limited account creation.

import { z } from 'zod';
import { fail, json, parseBody } from '@/lib/server/http';
import { checkRateLimit } from '@/lib/server/rateLimit';
import { createAnonClient } from '@/lib/supabase/server';

const schema = z.object({
  email: z.string().trim().toLowerCase().min(1).max(320),
  password: z.string().min(1).max(1024),
  username: z.string().trim().max(200).optional().default(''),
});

export async function POST(request: Request) {
  try {
    const body = await parseBody(request, schema, 'Email and password are required');
    if (!body.ok) return body.response;
    const { email, password } = body.data;
    const username = body.data.username.slice(0, 40);

    const limit = await checkRateLimit(request, { email });
    if (!limit.allowed) {
      return json(
        { error: 'Too many attempts. Please try again later.', retryAfter: limit.retryAfter },
        429,
        { 'Retry-After': String(limit.retryAfter) },
      );
    }

    // Stateless client: signing up does not log the browser in. The user is
    // sent to the login page afterwards, as before.
    const { data, error } = await createAnonClient().auth.signUp({
      email,
      password,
      options: username ? { data: { username } } : undefined,
    });
    if (error) return fail(error.message || 'Signup failed', 400);

    return json({ ok: true, needsEmailConfirmation: !data.session });
  } catch (err) {
    console.error('authSignup unexpected error:', err);
    return fail('Registration service error', 500);
  }
}
