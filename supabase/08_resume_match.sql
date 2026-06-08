-- jobradar: resume↔job-description matching
--
-- The match score is now resume-to-JD alignment only (preferences just filter
-- discovery). For each job we score every resume, pick the best, and persist
-- the winning resume plus the keyword/phrase evidence and tweak suggestions.
--
-- Apply after 05_job_matches.sql (and 07_jobs_discovery.sql). Every statement
-- is idempotent, so it's safe to re-run.

-- ---------------------------------------------------------------------------
-- job_matches: best-resume + evidence columns
-- ---------------------------------------------------------------------------

-- The highest-scoring resume for this job. resume_id (from 05) is kept in sync
-- with this; best_resume_id is the explicit, self-documenting column.
alter table public.job_matches
  add column if not exists best_resume_id uuid
    references public.resumes (id) on delete set null;

-- Snapshot of the resume's title at scoring time, so the Jobs page can show
-- "Best resume to use" without a join (and survives the resume being renamed).
alter table public.job_matches
  add column if not exists best_resume_title text;

-- Evidence + guidance, all JSONB arrays of strings.
alter table public.job_matches
  add column if not exists matched_keywords jsonb not null default '[]'::jsonb;
alter table public.job_matches
  add column if not exists matched_phrases jsonb not null default '[]'::jsonb;
alter table public.job_matches
  add column if not exists missing_keywords jsonb not null default '[]'::jsonb;
alter table public.job_matches
  add column if not exists resume_tweaks jsonb not null default '[]'::jsonb;

-- When this match was last (re)scored.
alter table public.job_matches
  add column if not exists scored_at timestamptz;

create index if not exists job_matches_best_resume_idx
  on public.job_matches (best_resume_id);

-- The match score itself lives in job_matches.score (numeric, from 05) and is
-- mirrored to jobs.match_score (from 07) for ranking/filtering on the Jobs page.

-- ---------------------------------------------------------------------------
-- Grants
--
-- The base privileges were granted to `authenticated` in 07_jobs_discovery.sql
-- and apply to the new columns automatically. Re-affirmed here (idempotent) so
-- this migration is self-sufficient if applied on its own.
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.job_matches to authenticated;
