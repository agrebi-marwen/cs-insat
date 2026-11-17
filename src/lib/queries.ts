// Shared Supabase reads, used through React Query so that pages share one
// cache: navigating between dashboard pages reuses data instead of refetching.

import type { SupabaseClient } from '@supabase/supabase-js';
import { queryOptions } from '@tanstack/react-query';
import { unwrap } from '@/components/Providers';
import type { Challenge, Roadmap } from '@/types/db';

/** Per-user data must never be served stale. */
export const FRESH = { staleTime: 0 } as const;

export interface MySubmission {
  id: string;
  submitted_at: string | null;
  status: string | null;
  challenge_id: string;
  submission_url: string | null;
}

export const activeChallengesQuery = (supabase: SupabaseClient) =>
  queryOptions({
    queryKey: ['challenges', 'active'],
    queryFn: () =>
      unwrap<Challenge[] | null>(
        supabase
          .from('challenges')
          .select('id, title, instructions, month_year, points_worth, is_active, category_id, tags')
          .eq('is_active', true)
          .order('created_at', { ascending: false }),
      ).then((rows) => rows ?? []),
  });

export const allChallengesQuery = (supabase: SupabaseClient) =>
  queryOptions({
    queryKey: ['challenges', 'all'],
    queryFn: () =>
      unwrap<Challenge[] | null>(
        supabase
          .from('challenges')
          .select(
            'id, title, instructions, month_year, points_worth, is_active, category_id, tags, challenge_categories (id, slug, name)',
          )
          .order('created_at', { ascending: false }),
      ).then((rows) => rows ?? []),
  });

export const mySubmissionsQuery = (supabase: SupabaseClient, userId: string) =>
  queryOptions({
    queryKey: ['my-submissions', userId],
    ...FRESH,
    queryFn: () =>
      unwrap<MySubmission[] | null>(
        supabase
          .from('submissions')
          .select('id, submitted_at, status, challenge_id, submission_url')
          .eq('user_id', userId)
          .order('submitted_at', { ascending: false }),
      ).then((rows) => rows ?? []),
  });

export const roadmapsQuery = (supabase: SupabaseClient, type: 'learn' | 'nodes') =>
  queryOptions({
    queryKey: ['roadmaps', type],
    queryFn: () =>
      unwrap<Roadmap[] | null>(
        supabase
          .from('roadmaps')
          .select('id, slug, title, description, difficulty')
          .eq('type', type)
          .order('created_at', { ascending: true }),
      ).then((rows) => rows ?? []),
  });

export const roadmapQuery = (supabase: SupabaseClient, id: string) =>
  queryOptions({
    queryKey: ['roadmap', id],
    queryFn: () =>
      unwrap<Roadmap | null>(
        supabase.from('roadmaps').select('id, slug, title, description, difficulty').eq('id', id).maybeSingle(),
      ),
  });
