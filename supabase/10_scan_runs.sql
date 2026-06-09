-- jobradar: scan_runs (one row per background job-scan run)
--
-- The "Run Job Scan" button now kicks off a background job instead of blocking
-- the request. This table tracks each run's lifecycle + tallies so the UI can
-- poll status and show "running / completed / failed". Apply after
-- 08_resume_match.sql. Every statement is idempotent.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table if not exists public.scan_runs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  status          text not null default 'running'
                  check (status in ('running', 'success', 'failed')),
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  sources_scanned integer,
  jobs_found      integer,
  jobs_saved      integer,
  jobs_scored     integer,
  error_message   text
);

-- Latest-run-per-user lookup (the page + poll route both order by this).
create index if not exists scan_runs_user_started_idx
  on public.scan_runs (user_id, started_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- The start action inserts/reads via the user's (authenticated) client, so it
-- needs owner-scoped select + insert + update. The background job writes via
-- the service-role client, which bypasses RLS entirely — no policy needed.
-- ---------------------------------------------------------------------------
alter table public.scan_runs enable row level security;

drop policy if exists "scan_runs select own" on public.scan_runs;
create policy "scan_runs select own" on public.scan_runs
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "scan_runs insert own" on public.scan_runs;
create policy "scan_runs insert own" on public.scan_runs
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "scan_runs update own" on public.scan_runs;
create policy "scan_runs update own" on public.scan_runs
  for update to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "scan_runs delete own" on public.scan_runs;
create policy "scan_runs delete own" on public.scan_runs
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Grants
--
-- `authenticated` needs base table privileges before RLS is consulted, or
-- Postgres returns "permission denied for table ..." before policies run.
-- Idempotent.
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.scan_runs to authenticated;
