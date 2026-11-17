import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseAnonKey, supabaseServiceKey, supabaseUrl } from '@/lib/env';

/** Supabase client bound to the session cookies of the request (RLS as the user). */
export async function createSessionClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) cookieStore.set(name, value, options);
        } catch {
          // Server Components cannot write cookies; src/proxy.ts refreshes them.
        }
      },
    },
  });
}

const stateless = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};

/** Service-role client for trusted server work (bypasses RLS when the key is set). */
export function createAdminClient(): SupabaseClient {
  return createClient(supabaseUrl(), supabaseServiceKey(), stateless);
}

/** Anonymous client with no session storage (signup, token checks). */
export function createAnonClient(): SupabaseClient {
  return createClient(supabaseUrl(), supabaseAnonKey(), stateless);
}

/** Client that acts as the owner of a bearer access token (RLS as that user). */
export function createTokenClient(accessToken: string): SupabaseClient {
  return createClient(supabaseUrl(), supabaseAnonKey(), {
    ...stateless,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export interface SessionUser {
  id: string;
  email: string | null;
}

/**
 * Current user for Server Components. Verifies the JWT (locally when the
 * project uses asymmetric signing keys) and returns null when signed out.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  return { id: claims.sub, email: typeof claims.email === 'string' ? claims.email : null };
}
