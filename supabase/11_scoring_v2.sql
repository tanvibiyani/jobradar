-- jobradar: scoring v2 (resume↔JD ATS alignment)
--
-- The matcher now produces a richer, component-based breakdown. The existing
-- columns are reused where they map cleanly; this migration adds the genuinely
-- new detail fields. Apply after 08_resume_match.sql. Every statement is
-- idempotent.
--
-- Column mapping (matcher field -> job_matches column):
--   matchedAtsKeywords        -> matched_keywords        (existing)
--   matchedExactPhrases       -> matched_phrases         (existing)
--   missingImportantKeywords  -> missing_keywords        (existing)
--   resumeTweaks              -> resume_tweaks           (existing)
--   matchedResponsibilities   -> matched_responsibilities    (new)
--   missingCorePhrases        -> missing_phrases             (new)
--   experienceRequirement     -> experience_requirement      (new)
--   experienceAlignmentReason -> experience_alignment_reason (new)
--   matchReason               -> match_reason                (new)

alter table public.job_matches
  add column if not exists matched_responsibilities jsonb not null default '[]'::jsonb;

alter table public.job_matches
  add column if not exists missing_phrases jsonb not null default '[]'::jsonb;

alter table public.job_matches
  add column if not exists experience_requirement text;

alter table public.job_matches
  add column if not exists experience_alignment_reason text;

alter table public.job_matches
  add column if not exists match_reason text;

-- Base privileges already granted in 07; re-affirmed (idempotent) and they
-- apply to the new columns automatically.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.job_matches to authenticated;
