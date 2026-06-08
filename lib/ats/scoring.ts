import type { DiscoveredJob, MatchResult, Preferences } from "./types";

// Fixed point caps per dimension (sum = 100). Scores are an absolute sum of
// these — never renormalized — so reaching 100 requires a job to max out *all
// four* dimensions at once, which is rare. A sparse profile (e.g. only roles
// set) is bounded by the caps of the dimensions it actually fills.
const CAPS = { title: 35, keywords: 25, resume: 25, location: 15 } as const;

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
 * Score a job 0–100 against preferences and resume text using fixed per-
 * dimension caps (title 35, keywords 25, resume 25, location 15). Each
 * dimension contributes its cap × a 0–1 sub-score; inactive dimensions (no
 * roles, no keywords, no resume, no location/remote preference) contribute 0
 * and are NOT renormalized away. A perfect 100 therefore requires a job to
 * fully satisfy every dimension simultaneously, so high scores stay rare.
 */
export function scoreJob(
  job: DiscoveredJob,
  prefs: Preferences,
  resumeText: string,
): MatchResult {
  const haystack = `${job.title} ${job.description ?? ""}`;

  const rolesActive = prefs.roles.length > 0;
  const keywordsActive = prefs.keywords.length > 0;
  const resumeTokens = resumeText ? tokenSet(resumeText) : new Set<string>();
  const resumeActive = resumeTokens.size > 0;
  const wantsLocation = prefs.locations.length > 0 || prefs.remote;

  if (!rolesActive && !keywordsActive && !resumeActive && !wantsLocation) {
    return {
      score: null,
      reasons: {
        title: 0,
        keywords: 0,
        resume: 0,
        location: 0,
        summary: "No preferences or resume to score against.",
        notes: [],
      },
    };
  }

  // Title: how well the posting title matches the user's target roles.
  const titleSub = rolesActive ? phraseHitRate(prefs.roles, job.title) : 0;

  // Keywords: share of preference keywords found anywhere in the posting.
  const keywordSub = keywordsActive ? phraseHitRate(prefs.keywords, haystack) : 0;

  // Resume overlap: share of the posting's significant tokens that also appear
  // in the resume. Denominator is capped so a perfect 1.0 is hard to reach.
  let resumeSub = 0;
  if (resumeActive) {
    const jobTokens = tokenSet(haystack);
    let shared = 0;
    for (const t of jobTokens) if (resumeTokens.has(t)) shared++;
    const denom = Math.min(jobTokens.size, 60) || 1;
    resumeSub = Math.min(1, shared / denom);
  }

  // Location / remote fit (binary-ish): full credit for an exact remote or
  // location match, half for a remote job when only locations were requested.
  let locationSub = 0;
  if (wantsLocation) {
    if (prefs.remote && job.remote) locationSub = 1;
    else if (prefs.locations.length && locationMatches(job, prefs.locations)) locationSub = 1;
    else if (job.remote) locationSub = 0.5;
  }

  const titlePts = Math.round(titleSub * CAPS.title);
  const keywordPts = Math.round(keywordSub * CAPS.keywords);
  const resumePts = Math.round(resumeSub * CAPS.resume);
  const locationPts = Math.round(locationSub * CAPS.location);
  const score = titlePts + keywordPts + resumePts + locationPts;

  const notes: string[] = [];
  if (titlePts > 0) notes.push("title match");
  if (keywordPts > 0) notes.push("keyword match");
  if (resumePts > 0) notes.push("resume overlap");
  if (locationPts > 0) notes.push(prefs.remote ? "remote match" : "location match");

  const summary =
    `Title ${titlePts}/${CAPS.title} · Keywords ${keywordPts}/${CAPS.keywords} · ` +
    `Resume ${resumePts}/${CAPS.resume} · Location ${locationPts}/${CAPS.location}`;

  return {
    score,
    reasons: {
      title: titlePts,
      keywords: keywordPts,
      resume: resumePts,
      location: locationPts,
      summary,
      notes,
    },
  };
}
