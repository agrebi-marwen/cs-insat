-- CP judge update (mirrors db/cp_problems.sql and db/cp_multiple_submissions.sql):
--   1. memory limit up to 256 MB
--   2. MLE (memory limit exceeded) verdict
--   3. submissions stuck in PENDING for over 2 minutes are closed as a judge
--      failure instead of blocking the user forever

alter table public.cp_problems drop constraint if exists cp_problems_memory_limit_mb_check;

alter table public.cp_problems add constraint cp_problems_memory_limit_mb_check
  check (memory_limit_mb between 1 and 256);

alter table public.cp_submission_details drop constraint if exists cp_submission_details_verdict_check;

alter table public.cp_submission_details add constraint cp_submission_details_verdict_check
  check (verdict in ('PENDING','AC','WA','TLE','MLE','RE','CE'));

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

revoke all on function public.create_cp_submission(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_cp_submission(uuid, uuid, text, text) to service_role;
