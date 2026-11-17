// Server-side environment access. Variable names are unchanged from the
// previous static deployment, so the existing Vercel env config keeps working.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export function supabaseUrl(): string {
  return required('SUPABASE_URL')
    .replace(/\/+$/, '')
    .replace(/\/rest\/v1$/i, '');
}

export function supabaseAnonKey(): string {
  return required('SUPABASE_ANON_KEY');
}

/** Service role key when configured, otherwise the anon key (RLS applies). */
export function supabaseServiceKey(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey();
}
