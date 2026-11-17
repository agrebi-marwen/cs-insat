// POST /api/rateLimit - kept for compatibility with older clients.
// Auth itself is rate limited inside /api/authLogin and /api/authSignup.

import { z } from 'zod';
import { json, parseBody } from '@/lib/server/http';
import { checkRateLimit } from '@/lib/server/rateLimit';

const schema = z.object({ email: z.string().trim().toLowerCase().min(1).max(320) });

export async function POST(request: Request) {
  const body = await parseBody(request, schema, 'Email required');
  if (!body.ok) return body.response;

  const limit = await checkRateLimit(request, { email: body.data.email });
  if (!limit.allowed) {
    return json(
      { error: 'Too many attempts. Please try again later.', retryAfter: limit.retryAfter },
      429,
      { 'Retry-After': String(limit.retryAfter) },
    );
  }
  return json({ allowed: true, attemptsRemaining: 0 });
}
