// api/_lib/supabase.js - Shared Supabase REST helpers for serverless functions.

export function supabaseUrl() {
  return String(process.env.SUPABASE_URL || '')
    .replace(/\/+$/, '')
    .replace(/\/rest\/v1$/i, '');
}

export function supabaseKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
}

async function request(path, { method = 'GET', body, token, key = supabaseKey() } = {}) {
  const headers = {
    apikey: key,
    'Content-Type': 'application/json'
  };
  headers.Authorization = token ? `Bearer ${token}` : `Bearer ${key}`;

  let response;
  try {
    response = await fetch(`${supabaseUrl()}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (err) {
    return {
      ok: false,
      status: 502,
      data: { error: `Supabase request failed: ${err.message}` }
    };
  }

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text || `Supabase returned HTTP ${response.status}` };
  }
  return { ok: response.ok, status: response.status, data };
}

export async function signInWithPassword(email, password) {
  const { ok, data } = await request('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email, password },
    key: process.env.SUPABASE_ANON_KEY
  });

  if (!ok) {
    return {
      error: (data && (data.msg || data.error_description || data.error)) ||
        'Invalid login credentials'
    };
  }
  return { session: data };
}

export async function signUp({ email, password, username }) {
  const { ok, data } = await request('/auth/v1/signup', {
    method: 'POST',
    key: process.env.SUPABASE_ANON_KEY,
    body: {
      email,
      password,
      data: username ? { username } : undefined
    }
  });

  if (!ok) {
    return {
      error: (data && (data.msg || data.error_description || data.error)) ||
        'Signup failed'
    };
  }
  return { user: data.user, session: data.session };
}

export async function getUser(accessToken) {
  if (!accessToken) return null;
  const { ok, data } = await request('/auth/v1/user', { token: accessToken });
  return ok && data ? data : null;
}

export async function getProfileRole(userId, accessToken) {
  const { ok, data } = await request(
    `/rest/v1/profiles?select=role&id=eq.${encodeURIComponent(userId)}`,
    { token: accessToken }
  );
  if (!ok || !Array.isArray(data) || data.length === 0) return null;
  return data[0].role || null;
}
