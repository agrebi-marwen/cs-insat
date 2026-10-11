-- ============================================================================
-- THE TIME PORTAL - SITE-SIDE SUBMISSION POLICY
-- Run this in your Supabase Dashboard - SQL Editor.
-- Safe to run more than once (IF EXISTS).
--
-- Legacy policy migration: removes the old one-row-per-challenge constraint.
-- CP submission eligibility is now enforced transactionally by
-- db/cp_multiple_submissions.sql and api/cpSubmit.js.
-- ============================================================================

-- Remove the database-level "one submission per (user, challenge)" rule.
alter table public.submissions
  drop constraint if exists unique_user_challenge;

-- Keep a plain index on (user_id, challenge_id) so the app's eligibility
-- checks stay fast now that rows are no longer unique.
create index if not exists submissions_user_challenge_idx
  on public.submissions (user_id, challenge_id);