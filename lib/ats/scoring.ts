import type { DiscoveredJob, Preferences } from "./types";

// ---------------------------------------------------------------------------
// Discovery filter (preferences narrow WHICH jobs are discovered — they no
// longer affect the match score). The actual match score is resume-to-job
// alignment only; see lib/ats/match.ts.
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "the", "and", "for", "with", "you", "your", "our", "are", "all", "any",
  "from", "this", "that", "will", "have", "has", "a", "an", "of", "to", "in",
  "on", "at", "or", "is", "be", "as", "we", "us", "it", "by", "job", "role",
  "team", "work", "working", "experience", "years", "etc",
]);

/** Lowercase, split on non-word chars, drop stopwords and very short tokens. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function tokenSet(text: string): Set<string> {
  return new Set(tokenize(text));
}

/** Fraction of `needles` (as whole phrases or tokens) present in `haystack`. */
function phraseHitRate(needles: string[], haystack: string): number {
  if (needles.length === 0) return 0;
  const hay = haystack.toLowerCase();
  const haySet = tokenSet(haystack);
  let hits = 0;
  for (const needle of needles) {
    const n = needle.toLowerCase().trim();
    if (!n) continue;
    // A multi-word preference counts if its phrase appears, or if a majority
    // of its tokens do (so "distributed systems" still hits "distributed").
    if (hay.includes(n)) {
      hits++;
      continue;
    }
    const parts = tokenize(n);
    if (parts.length > 0) {
      const present = parts.filter((p) => haySet.has(p)).length;
      if (present / parts.length >= 0.5) hits++;
    }
  }
  return hits / needles.length;
}

function locationMatches(job: DiscoveredJob, locations: string[]): boolean {
  if (job.remote) return true;
  if (!job.location) return false;
  const loc = job.location.toLowerCase();
  return locations.some((l) => {
    const want = l.toLowerCase().trim();
    return want.length > 0 && loc.includes(want);
  });
}

/**
 * Decide whether a discovered job is relevant enough to keep. Empty preference
 * dimensions don't constrain — a user with no preferences set keeps everything.
 */
export function passesFilter(job: DiscoveredJob, prefs: Preferences): boolean {
  // Remote is a hard constraint when requested.
  if (prefs.remote && !job.remote) return false;

  // Location constraint only bites when the user isn't asking for remote-only
  // (in which case the remote gate above already did the work).
  if (!prefs.remote && prefs.locations.length > 0) {
    if (!locationMatches(job, prefs.locations)) return false;
  }

  // Textual relevance: if the user named roles or keywords, require the job to
  // match at least one of them. Roles match against the title; keywords match
  // against the whole posting.
  const haystack = `${job.title} ${job.description ?? ""}`;
  const wantsRoles = prefs.roles.length > 0;
  const wantsKeywords = prefs.keywords.length > 0;
  if (wantsRoles || wantsKeywords) {
    const roleHit = wantsRoles && phraseHitRate(prefs.roles, job.title) > 0;
    const keywordHit = wantsKeywords && phraseHitRate(prefs.keywords, haystack) > 0;
    if (!roleHit && !keywordHit) return false;
  }

  return true;
}
