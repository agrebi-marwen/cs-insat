// api/authLogin.js - Serverless sign-in.
// Rate limits (fail-closed), then performs the password grant against Supabase
// on the server so the limit cannot be bypassed from the browser.

import { checkRateLimit } from './_lib/rateLimit.js';
import { signInWithPassword } from './_lib/supabase.js';
import { applyCommonHeaders, handlePreflight, readBody } from './_lib/http.js';

export default async function handler(req, res) {
  try {
  applyCommonHeaders(req, res);
  if (handlePreflight(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = await readBody(req);
  const email = String(body.email || '').trim().toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  // Fail-closed rate limit gate.
  const limit = await checkRateLimit(req, { email });
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfter));
    return res.status(429).json({ error: 'Too many attempts. Please try again later.', retryAfter: limit.retryAfter });
  }

  const { session, error } = await signInWithPassword(email, password);
  if (error) {
    console.error('authLogin Supabase error:', error);
    return res.status(401).json({ error });
  }

  return res.status(200).json({ session });
  } catch (err) {
    console.error('authLogin unexpected error:', err);
    return res.status(500).json({ error: 'Authentication service error: ' + err.message });
  }
}