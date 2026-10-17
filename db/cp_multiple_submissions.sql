-- Competitive-programming submission policy and idempotent scoring.
-- Run after cp_problems.sql in the Supabase SQL editor.

alter table public.cp_problems
  add column if not exists allow_multiple_submissions boolean not null default false;

create table if not exists public.challenge_awards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  submission_id uuid not null references public.submissions(id) on delete restrict,
  points integer not null check (points >= 0),
  awarded_at timestamptz not null default now(),
  unique (user_id, challenge_id)
);

create index if not exists challenge_awards_user_id_idx
  on public.challenge_awards (user_id);

alter table public.challenge_awards enable row level security;

drop policy if exists "challenge_awards_select_own" on public.challenge_awards;
create policy "challenge_awards_select_own"
  on public.challenge_awards for select
  to authenticated using (user_id = auth.uid());

drop policy if exists "challenge_awards_admin_select" on public.challenge_awards;
create policy "challenge_awards_admin_select"
  on public.challenge_awards for select
  to authenticated using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create or replace function public.create_cp_submission(
  p_user_id uuid,
  p_challenge_id uuid,
  p_language text,
  p_code text
)
returns table (submission_id uuid, detail_id uuid, allow_multiple boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cp public.cp_problems%rowtype;
  v_submission_id uuid;
  v_detail_id uuid;
begin
  select * into v_cp
    from public.cp_problems
   where challenge_id = p_challenge_id
   for update;

  if not found then
    raise exception 'This challenge is not a graded CP problem';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || p_challenge_id::text, 0)
  );

  -- A CP submission still PENDING after 2 minutes means the judge stopped
  -- before saving a verdict (crash or timeout). Close it as a judge failure
  -- so it no longer blocks the user with "already being judged".
  with stale as (
    update public.submissions
       set status = 'REJECTED'
     where user_id = p_user_id and challenge_id = p_challenge_id
       and status = 'PENDING' and submission_url is null
       and submitted_at < now() - interval '2 minutes'
    returning id
  )
  update public.cp_submission_details d
     set verdict = 'RE',
         run_output = 'Judging did not finish because of a server problem, not because of your code. Please contact the hosts.'
    from stale
   where d.submission_id = stale.id and d.verdict = 'PENDING';

  if exists (
    select 1 from public.submissions
     where user_id = p_user_id and challenge_id = p_challenge_id
       and status = 'APPROVED'
  ) then
    raise exception 'You have already succeeded on this challenge.';
  end if;

  if not v_cp.allow_multiple_submissions and exists (
    select 1 from public.submissions
     where user_id = p_user_id and challenge_id = p_challenge_id
  ) then
    raise exception 'Only one submission is allowed for this challenge.';
  end if;

  if exists (
    select 1 from public.submissions
     where user_id = p_user_id and challenge_id = p_challenge_id
       and status = 'PENDING' and submission_url is null
  ) then
    raise exception 'A submission is already being judged.';
  end if;

  insert into public.submissions (user_id, challenge_id, submission_url, status)
  values (p_user_id, p_challenge_id, null, 'PENDING')
  returning id into v_submission_id;

  insert into public.cp_submission_details
    (submission_id, user_id, challenge_id, language, code, verdict)
  values
    (v_submission_id, p_user_id, p_challenge_id, p_language, p_code, 'PENDING')
  returning id into v_detail_id;

  return query select v_submission_id, v_detail_id, v_cp.allow_multiple_submissions;
end;
$$;

create or replace function public.complete_cp_submission(
  p_submission_id uuid,
  p_detail_id uuid,
  p_verdict text,
  p_compile_output text default null,
  p_run_output text default null,
  p_execution_time_ms integer default null,
  p_memory_kb integer default null,
  p_test_results jsonb default '[]'::jsonb
)
returns table (awarded boolean, points integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.submissions%rowtype;
  v_challenge public.challenges%rowtype;
  v_points integer := 0;
  v_awarded boolean := false;
begin
  select * into v_sub from public.submissions
   where id = p_submission_id for update;
  if not found then raise exception 'Submission not found'; end if;

  update public.cp_submission_details
     set verdict = p_verdict,
         compile_output = p_compile_output,
         run_output = p_run_output,
         execution_time_ms = p_execution_time_ms,
         memory_kb = p_memory_kb,
         test_results = coalesce(p_test_results, '[]'::jsonb)
   where id = p_detail_id and submission_id = p_submission_id;
  if not found then raise exception 'Submission details not found'; end if;

  update public.submissions
     set status = case when p_verdict = 'AC' then 'APPROVED' else 'REJECTED' end
   where id = p_submission_id;

  if p_verdict = 'AC' then
    select * into v_challenge from public.challenges where id = v_sub.challenge_id;
    v_points := coalesce(v_challenge.points_worth, 0);
    insert into public.challenge_awards (user_id, challenge_id, submission_id, points)
    values (v_sub.user_id, v_sub.challenge_id, p_submission_id, v_points)
    on conflict (user_id, challenge_id) do nothing;
    v_awarded := found;
    if v_awarded then
      update public.profiles
         set total_points = total_points + v_points
       where id = v_sub.user_id;
    end if;
  end if;

  return query select v_awarded, v_points;
end;
$$;

revoke all on function public.create_cp_submission(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.complete_cp_submission(uuid, uuid, text, text, text, integer, integer, jsonb) from public, anon, authenticated;
grant execute on function public.create_cp_submission(uuid, uuid, text, text) to service_role;
grant execute on function public.complete_cp_submission(uuid, uuid, text, text, text, integer, integer, jsonb) to service_role;
