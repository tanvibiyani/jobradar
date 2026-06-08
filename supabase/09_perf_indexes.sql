-- jobradar: performance indexes for the Jobs page + dashboard
--
-- Backs the common navigation queries:
--   * Jobs page facet + filters by company / source  (eq on company_name, source)
--   * Jobs page free-text filters on title / location (ILIKE '%term%')
--   * Jobs page ordering by match_score / discovered_at (already indexed in
--     04/07; not repeated here)
--   * Dashboard counts per user (already covered by the *_user_id_idx indexes)
--
-- Every statement is idempotent, so it's safe to re-run. Apply after
-- 08_resume_match.sql.

-- ---------------------------------------------------------------------------
-- Equality filters: company / source, scoped per user.
-- The leading user_id matches RLS (user_id = auth.uid()) so these stay useful
-- even when no company/source filter is applied (e.g. the facet scan).
-- ---------------------------------------------------------------------------
create index if not exists jobs_user_company_idx
  on public.jobs (user_id, company_name);

create index if not exists jobs_user_source_idx
  on public.jobs (user_id, source);

-- ---------------------------------------------------------------------------
-- Substring search: title / location use ILIKE '%term%', which a plain b-tree
-- can't accelerate. pg_trgm GIN indexes turn those into index scans.
-- ---------------------------------------------------------------------------
create extension if not exists pg_trgm;

create index if not exists jobs_title_trgm_idx
  on public.jobs using gin (title gin_trgm_ops);

create index if not exists jobs_location_trgm_idx
  on public.jobs using gin (location gin_trgm_ops);

-- Note: the "hide dismissed" id lookup (job_matches where status = 'rejected',
-- per user) is already served by job_matches_user_status_idx from 05.
