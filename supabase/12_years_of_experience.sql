-- jobradar: candidate years of experience (YOE) on preferences
--
-- Adds a per-user years-of-experience value used by the resume↔JD matcher to
-- score how well each role's experience requirement fits the user. Nullable and
-- defaults to blank; when unset, the matcher does not apply experience scoring
-- and caps the score at 85% (see lib/ats/match.ts). Apply after
-- 02_preferences.sql. Every statement is idempotent.

alter table public.preferences
  add column if not exists years_of_experience integer;

-- Keep stored values sane (0–60 whole years). NULL passes the check, preserving
-- "blank = no value". Guarded so re-running doesn't error on an existing one.
do $$
begin
  alter table public.preferences
    add constraint preferences_years_of_experience_range
    check (years_of_experience is null
           or (years_of_experience >= 0 and years_of_experience <= 60));
exception
  when duplicate_object then null;
end $$;

-- Base privileges already granted in 02; re-affirmed (idempotent) and they
-- apply to the new column automatically.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.preferences to authenticated;
