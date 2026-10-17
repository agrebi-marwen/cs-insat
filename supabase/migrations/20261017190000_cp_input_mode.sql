-- CP input format per problem.
--   'single': each test is given to a fresh run of the program on its own
--             (no "t" line) - CSAcademy / AtCoder style. Default for new problems.
--   'multi' : all tests at once, input starts with t - Codeforces "t test
--             cases" style. Existing problems keep this (their statements and
--             solutions are written for it).

alter table public.cp_problems
  add column if not exists input_mode text not null default 'multi';

alter table public.cp_problems drop constraint if exists cp_problems_input_mode_check;

alter table public.cp_problems add constraint cp_problems_input_mode_check
  check (input_mode in ('single', 'multi'));

-- Existing rows got 'multi' above; problems created from now on default to 'single'.
alter table public.cp_problems alter column input_mode set default 'single';
