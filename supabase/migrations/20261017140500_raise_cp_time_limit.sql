alter table public.cp_problems drop constraint if exists cp_problems_time_limit_ms_check;

alter table public.cp_problems add constraint cp_problems_time_limit_ms_check
  check (time_limit_ms between 100 and 5000);
