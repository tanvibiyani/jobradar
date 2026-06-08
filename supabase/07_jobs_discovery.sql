-- jobradar: automated discovery
--
-- Moves jobs from "manually tracked per company" to "automatically discovered
-- across public ATS feeds and ranked by match score". Apply after 04_jobs.sql
-- and 05_job_matches.sql. Every statement is idempotent so it's safe to re-run.

-- ---------------------------------------------------------------------------
-- jobs: columns for discovered + scored postings
-- ---------------------------------------------------------------------------

-- Discovered jobs aren't tied to a user-created company row, so they carry the
-- company name inline. company_id stays nullable for legacy manual jobs.
alter table public.jobs
  add column if not exists company_name text;

-- When the scanner first discovered this posting. Distinct from created_at so
-- re-scans (which upsert the row) don't reset it — the upsert omits this column
-- and the default only fires on insert.
alter table public.jobs
  add column if not exists discovered_at timestamptz not null default now();

-- Cached rules-based match score (0–100) for ordering on the Jobs page. The
-- canonical score + reasons also live in job_matches; this denormalized copy
-- keeps "rank by best match" a plain indexed ORDER BY.
alter table public.jobs
  add column if not exists match_score numeric;

-- `source` already exists from 04_jobs.sql; ensure it for older databases.
alter table public.jobs
  add column if not exists source text;

-- Rank-by-match index (best first, unscored last).
create index if not exists jobs_user_match_idx
  on public.jobs (user_id, match_score desc nulls last);

create index if not exists jobs_user_discovered_idx
  on public.jobs (user_id, discovered_at desc nulls last);

-- Dedup of discovered jobs relies on the unique (user_id, url) index. It ships
-- in 04_jobs.sql; re-declare it here so this migration is self-sufficient.
create unique index if not exists jobs_user_url_uniq
  on public.jobs (user_id, url);

-- ---------------------------------------------------------------------------
-- Grants
--
-- `authenticated` needs base table privileges before RLS is consulted, or
-- Postgres returns "permission denied for table ..." before policies run.
-- 05_job_matches.sql created the table and its policies but never granted these
-- privileges, so the scanner's writes to job_matches would fail without this.
-- All grants are idempotent.
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.jobs to authenticated;
grant select, insert, update, delete on public.job_matches to authenticated;
