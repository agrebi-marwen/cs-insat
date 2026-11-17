'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useState, type ReactNode } from 'react';

const SupabaseContext = createContext<SupabaseClient | null>(null);

/** Browser Supabase client (session shared with the server through cookies). */
export function useSupabase(): SupabaseClient {
  const client = useContext(SupabaseContext);
  if (!client) throw new Error('useSupabase must be used inside <Providers>');
  return client;
}

interface Props {
  supabaseUrl: string;
  supabaseAnonKey: string;
  children: ReactNode;
}

export function Providers({ supabaseUrl, supabaseAnonKey, children }: Props) {
  const [supabase] = useState(() => createBrowserClient(supabaseUrl, supabaseAnonKey));
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Catalog data changes rarely: serve from cache for 5 minutes,
            // de-duplicate concurrent requests and retry transient failures.
            staleTime: 5 * 60 * 1000,
            retry: 2,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <SupabaseContext.Provider value={supabase}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </SupabaseContext.Provider>
  );
}

/** Unwrap a Supabase response for React Query: throw on error, return typed data. */
export async function unwrap<T>(
  query: PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data as T;
}
