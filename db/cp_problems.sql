-- ============================================================================
-- THE TIME PORTAL - COMPETITIVE PROGRAMMING JUDGE
-- Run this in your Supabase Dashboard - SQL Editor.
-- Safe to run more than once (tables are created with IF NOT EXISTS,
-- indexes/policies use IF NOT EXISTS / drop-then-create).
--
-- Adds:
--   1. cp_problems            - per-challenge judge configuration
--   2. cp_submission_details  - submitted source + judge verdict
--   3. storage bucket "cp-tests" for the admin-provided test case file
--   4. relaxes submissions.submission_url (CP submissions have no repo URL)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. SUBMISSIONS - repo URL is no longer required (CP code submissions).
-- ----------------------------------------------------------------------------
alter table public.submissions
  alter column submission_url drop not null;

-- ----------------------------------------------------------------------------
-- 1. CP PROBLEMS - one row per CP challenge.
--    time_limit_ms  <= 1000 (1 second cap)
--    memory_limit_mb <= 10 (MB)  -- small problems; Piston containers are lean
--    test_file_path = storage path inside the "cp-tests" bucket, e.g.
--                     "<challenge_id>/tests.json.gz" — a gzip JSON archive with a
--                     SINGLE Codeforces-style pair { "input", "expected" }:
--                     input starts with "t" (number of sub-tests) followed by all
--                     t data sets; expected is the concatenated output for all of
--                     them. The user's code is run ONCE against the whole input.
--    languages      = allowed submit languages (config keys in api/_lib/piston.js)
-- ----------------------------------------------------------------------------
create table if not exists public.cp_problems (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null unique,
  time_limit_ms integer not null default 1000 check (time_limit_ms between 100 and 1000),
  memory_limit_mb integer not null default 10 check (memory_limit_mb between 1 and 10),
  test_file_path text not null,
  languages text[] not null default array['c++','c','python','java'],
  allow_multiple_submissions boolean not null default false,
  created_at timestamptz not null default now(),
  constraint cp_problems_challenge_id_fkey foreign key (challenge_id)
    references public.challenges(id) on delete cascade
);

alter table public.cp_problems
  add column if not exists allow_multiple_submissions boolean not null default false;

create index if not exists cp_problems_challenge_id_idx on public.cp_problems (challenge_id);

-- ----------------------------------------------------------------------------
-- 1b. CONSTRAINT SYNC - "create table if not exists" skips existing tables, so
--    a constraint changed in a later migration never reaches a DB where the
--    table already existed (e.g. memory_limit_mb used to be 16..1024). Re-run
--    this file to drop the old check and apply the current one.
-- ----------------------------------------------------------------------------
alter table public.cp_problems drop constraint if exists cp_problems_memory_limit_mb_check;
alter table public.cp_problems add constraint cp_problems_memory_limit_mb_check
  check (memory_limit_mb between 1 and 10);

alter table public.cp_problems drop constraint if exists cp_problems_time_limit_ms_check;
alter table public.cp_problems add constraint cp_problems_time_limit_ms_check
  check (time_limit_ms between 100 and 1000);

-- ----------------------------------------------------------------------------
-- 2. CP SUBMISSION DETAILS - source code + judge verdict per submission.
--    verdict: PENDING (judging) | AC | WA | TLE | RE | CE
-- ----------------------------------------------------------------------------
create table if not exists public.cp_submission_details (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique,
  user_id uuid not null,
  challenge_id uuid not null,
  language text not null,
  code text not null,
  verdict text not null default 'PENDING'
    check (verdict in ('PENDING','AC','WA','TLE','RE','CE')),
  compile_output text,
  run_output text,
  execution_time_ms integer,
  memory_kb integer,
  test_results jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint cp_details_submission_id_fkey foreign key (submission_id)
    references public.submissions(id) on delete cascade,
  constraint cp_details_user_id_fkey foreign key (user_id)
    references public.profiles(id) on delete cascade,
  constraint cp_details_challenge_id_fkey foreign key (challenge_id)
    references public.challenges(id) on delete cascade
);

create index if not exists cp_details_submission_id_idx on public.cp_submission_details (submission_id);
create index if not exists cp_details_user_id_idx on public.cp_submission_details (user_id);
create index if not exists cp_details_challenge_id_idx on public.cp_submission_details (challenge_id);

-- ----------------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY
--    cp_problems: any user can read (needed to detect CP mode + show limits),
--                 only admins can write.
--    cp_submission_details: users select their own, admins select all,
--                 writes happen server-side with the service role key.
-- ----------------------------------------------------------------------------
alter table public.cp_problems enable row level security;

drop policy if exists "cp_problems_read_authenticated" on public.cp_problems;
create policy "cp_problems_read_authenticated"
  on public.cp_problems for select
  to authenticated using (true);

drop policy if exists "cp_problems_read_public" on public.cp_problems;
create policy "cp_problems_read_public"
  on public.cp_problems for select
  to anon using (true);

drop policy if exists "cp_problems_admin_insert" on public.cp_problems;
create policy "cp_problems_admin_insert"
  on public.cp_problems for insert
  to authenticated with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

drop policy if exists "cp_problems_admin_update" on public.cp_problems;
create policy "cp_problems_admin_update"
  on public.cp_problems for update
  to authenticated using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  ) with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

drop policy if exists "cp_problems_admin_delete" on public.cp_problems;
create policy "cp_problems_admin_delete"
  on public.cp_problems for delete
  to authenticated using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

alter table public.cp_submission_details enable row level security;

drop policy if exists "cp_details_select_own" on public.cp_submission_details;
create policy "cp_details_select_own"
  on public.cp_submission_details for select
  to authenticated using (
    exists (
      select 1 from public.submissions
      where submissions.id = cp_submission_details.submission_id
        and submissions.user_id = auth.uid()
    )
  );

drop policy if exists "cp_details_admin_select" on public.cp_submission_details;
create policy "cp_details_admin_select"
  on public.cp_submission_details for select
  to authenticated using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- ----------------------------------------------------------------------------
-- 4. STORAGE - private bucket for the compressed test-case archive.
--    Uploads are performed by the admin via the browser (authenticated).
--    The judge read path runs server-side with the service role key (bypasses RLS).
--    If your project already has default storage policies, they do not conflict
--    because everything is scoped to bucket_id = 'cp-tests'. Ensure no public
--    read policy is added for this bucket or hidden tests would leak.
--
--    NOTE: storage.buckets and storage.objects are owned by the
--    supabase_storage_admin role, not by the role your SQL editor session runs
--    as, so this script does NOT try to ALTER TABLE ... ENABLE ROW LEVEL
--    SECURITY or GRANT on those tables (that fails with "must be owner of
--    table buckets"). Supabase already ships with RLS enabled on both by
--    default and the necessary grants already in place, so only the policy
--    statements below are needed - creating/dropping policies is explicitly
--    delegated to the postgres role even without table ownership.
--
--    IMPORTANT: if the admin panel reports
--      "Failed to upload test file: new row violates row-level security policy"
--    then this file has NOT been (re)run, or one of these policies is missing.
--    The statements below are idempotent - run them again in the
--    Supabase SQL Editor and the error clears.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('cp-tests', 'cp-tests', false)
on conflict (id) do update set public = false;

drop policy if exists "cp_tests_admin_insert" on storage.objects;
create policy "cp_tests_admin_insert"
  on storage.objects for insert
  to authenticated with check (
    bucket_id = 'cp-tests' and
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

drop policy if exists "cp_tests_admin_update" on storage.objects;
create policy "cp_tests_admin_update"
  on storage.objects for update
  to authenticated using (
    bucket_id = 'cp-tests' and
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  ) with check (
    bucket_id = 'cp-tests' and
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

drop policy if exists "cp_tests_admin_delete" on storage.objects;
create policy "cp_tests_admin_delete"
  on storage.objects for delete
  to authenticated using (
    bucket_id = 'cp-tests' and
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- ============================================================================
-- Done. Manage the test file / limits from the Admin Panel -> Challenges.
-- Environment variables required by the judge (Vercel):
--   SUPABASE_SERVICE_ROLE_KEY  required so the judge can write submissions + read tests
-- Piston (emkc.org/api/v2) is a public API and requires no key.
-- ============================================================================