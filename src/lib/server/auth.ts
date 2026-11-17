import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAnonClient, createSessionClient, createTokenClient } from '@/lib/supabase/server';

export interface Caller {
  userId: string;
  /** Client that runs queries as the caller (RLS enforced). */
  db: SupabaseClient;
}

/**
 * Authenticate an API request. Accepts `Authorization: Bearer <token>` (used by
 * the admin panel) or the session cookies set at login. The token is always
 * validated against Supabase Auth, never trusted from the client.
 */
export async function authenticate(request: Request): Promise<Caller | null> {
  const header = request.headers.get('authorization') ?? '';
  if (header.startsWith('Bearer ')) {
    const token = header.slice(7).trim();
    if (!token) return null;
    const { data, error } = await createAnonClient().auth.getUser(token);
    if (error || !data.user) return null;
    return { userId: data.user.id, db: createTokenClient(token) };
  }

  const db = await createSessionClient();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) return null;
  return { userId: data.user.id, db };
}

export async function isAdmin(caller: Caller): Promise<boolean> {
  const { data, error } = await caller.db
    .from('profiles')
    .select('role')
    .eq('id', caller.userId)
    .maybeSingle();
  return !error && data?.role === 'admin';
}
