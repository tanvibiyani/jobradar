import type { DiscoveredJob, MatchResult, Preferences } from "./types";

// ---------------------------------------------------------------------------
// Rules-based matching. No LLMs — just token overlap and string matching.
//
// Two concerns live here:
//   1. passesFilter() — a gate deciding whether a discovered job is relevant
//      enough to store at all (roles / keywords / locations / remote).
//   2. scoreJob() — a 0–100 ranking signal saved alongside the stored job.
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

/**
 * Score a job 0–100 against preferences and resume text. Each dimension is only
 * weighted when there's something to compare against, then the active weights
 * are renormalized so a sparse profile still yields a meaningful score.
 */
export function scoreJob(
  job: DiscoveredJob,
  prefs: Preferences,
  resumeText: string,
): MatchResult {
  const haystack = `${job.title} ${job.description ?? ""}`;
  const notes: string[] = [];

  const title = prefs.roles.length ? phraseHitRate(prefs.roles, job.title) : 0;
  const keywords = prefs.keywords.length ? phraseHitRate(prefs.keywords, haystack) : 0;

  // Resume overlap: share of the resume's significant tokens that show up in the
  // posting. Caps at 0.6 raw before normalizing so a perfect 1.0 isn't required.
  let resume = 0;
  const resumeTokens = resumeText ? tokenSet(resumeText) : new Set<string>();
  if (resumeTokens.size > 0) {
    const jobTokens = tokenSet(haystack);
    let shared = 0;
    for (const t of jobTokens) if (resumeTokens.has(t)) shared++;
    const denom = Math.min(jobTokens.size, 60) || 1;
    resume = Math.min(1, shared / denom);
  }

  // Location / remote fit.
  const wantsLocation = prefs.locations.length > 0 || prefs.remote;
  let location = 0;
  if (wantsLocation) {
    if (prefs.remote && job.remote) location = 1;
    else if (prefs.locations.length && locationMatches(job, prefs.locations)) location = 1;
    else if (job.remote) location = 0.5;
  }

  const dims: Array<{ key: keyof MatchResult["reasons"]; weight: number; value: number; active: boolean }> = [
    { key: "title", weight: 0.35, value: title, active: prefs.roles.length > 0 },
    { key: "keywords", weight: 0.25, value: keywords, active: prefs.keywords.length > 0 },
    { key: "resume", weight: 0.25, value: resume, active: resumeTokens.size > 0 },
    { key: "location", weight: 0.15, value: location, active: wantsLocation },
  ];

  const active = dims.filter((d) => d.active);
  if (active.length === 0) {
    notes.push("No preferences or resume to score against.");
    return {
      score: null,
      reasons: { title: 0, keywords: 0, resume: 0, location: 0, notes },
    };
  }

  const totalWeight = active.reduce((s, d) => s + d.weight, 0);
  const weighted = active.reduce((s, d) => s + d.weight * d.value, 0);
  const score = Math.round((weighted / totalWeight) * 100);

  if (title > 0) notes.push("Title matches a target role.");
  if (keywords > 0) notes.push("Mentions your keywords.");
  if (resume >= 0.3) notes.push("Strong overlap with your resume.");
  if (location === 1) notes.push("Location/remote fits.");

  return {
    score,
    reasons: {
      title: Math.round(title * 100) / 100,
      keywords: Math.round(keywords * 100) / 100,
      resume: Math.round(resume * 100) / 100,
      location: Math.round(location * 100) / 100,
      notes,
    },
  };
}
