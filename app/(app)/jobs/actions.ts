"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { enabledSources } from "@/lib/ats/sources";
import { fetchSource } from "@/lib/ats/fetchers";
import { passesFilter } from "@/lib/ats/scoring";
import { matchJobToResumes, prepareResume } from "@/lib/ats/match";
import type { AtsSource, DiscoveredJob, Preferences } from "@/lib/ats/types";

/** One source that failed during a scan, with a short reason. */
export type SourceError = { source: string; error: string };

/** Per-scan tallies surfaced to the UI. */
export type ScanSummary = {
  sourcesScanned: number; // sources attempted this scan
  sourcesOk: number; // sources that returned without error
  jobsDiscovered: number; // unique jobs found across all sources
  jobsSaved: number; // job rows written to the database
  jobsScored: number; // jobs that received a resume match score
  errors: SourceError[]; // failures, by source
};

export type ScanState =
  | { ok: true; message: string; summary: ScanSummary }
  | { ok: false; error: string; summary?: ScanSummary }
  | null;

// --- Scan limits ----------------------------------------------------------
// The registry has ~120+ sources; these bounds keep one scan from overloading
// the server (and the database). Per-source job caps live in the fetchers.
//
// SCAN_CONCURRENCY: how many ATS feeds we fetch at once. The registry is
// fetched in full, but only this many requests are in flight at a time so we
// don't open 100+ sockets or buffer 100+ multi-MB payloads simultaneously.
const SCAN_CONCURRENCY = 8;
// MAX_CANDIDATES: cap how many discovered jobs we run the (heavier) resume
// matcher over per scan, so a preference-free profile can't make us score tens
// of thousands of jobs. Newest postings are preferred when over the cap.
const MAX_CANDIDATES = 2500;
// MAX_STORED: after scoring we keep only the best-ranked jobs, so a scan never
// writes an unbounded number of rows.
const MAX_STORED = 500;
// SOURCE_TIMEOUT_MS: an outer wall-clock bound on a single source. The fetchers
// already abort the HTTP request after their own timeout, but this guards the
// whole `fetchSource` call (parsing, normalization, a wedged socket) so one slow
// company can never hold up the scan. Sits just above the fetchers' own timeout.
const SOURCE_TIMEOUT_MS = 20_000;

/**
 * Reject with `label` if `p` hasn't settled within `ms`. The underlying work
 * isn't cancelled (the fetchers abort their own sockets); this just frees the
 * concurrency slot so a single hung source can't block the rest of the scan.
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms);
    p.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (reason) => {
        clearTimeout(timer);
        reject(reason);
      },
    );
  });
}

/**
 * Run `fn` over `items` with at most `limit` in flight at once. Never rejects —
 * each item resolves to a PromiseSettledResult so one bad source can't sink the
 * scan.
 */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const idx = next++;
      try {
        results[idx] = { status: "fulfilled", value: await fn(items[idx]) };
      } catch (reason) {
        results[idx] = { status: "rejected", reason };
      }
    }
  }
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

/**
 * Pin the session into the supabase-js client so RLS-bound writes carry the
 * user's access token. See the long-form rationale in
 * `app/(app)/resumes/actions.ts`.
 */
async function pinSession(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  if (!session?.access_token || !session?.refresh_token) {
    return {
      ok: false,
      error: "Session is not available to the server. Please sign in again.",
    };
  }
  await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  return { ok: true };
}

/** Normalize a URL for dedup + storage: drop the fragment and trailing slash. */
function normalizeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export async function runJobScan(
  _prev: ScanState,
  _formData: FormData,
): Promise<ScanState> {
  try {
    return await runJobScanInner();
  } catch (err) {
    // Last-resort guard: a scan must ALWAYS return a ScanState so the client's
    // pending flag resets and the button leaves its "Scanning…" state. Without
    // this, an unexpected throw (DB hang, bug) would reject the action and the
    // button could stay stuck.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[scan] aborted with unexpected error: ${message}`);
    return { ok: false, error: `Scan failed: ${message}` };
  }
}

async function runJobScanInner(): Promise<ScanState> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return { ok: false, error: "You must be signed in to run a job scan." };
  }

  const pinned = await pinSession(supabase);
  if (!pinned.ok) return { ok: false, error: pinned.error };

  // --- Load the user's preferences (default to "no constraints"). ----------
  const { data: prefRow } = await supabase
    .from("preferences")
    .select("roles,locations,keywords,min_salary,remote")
    .maybeSingle();

  const prefs: Preferences = {
    roles: prefRow?.roles ?? [],
    locations: prefRow?.locations ?? [],
    keywords: prefRow?.keywords ?? [],
    min_salary: prefRow?.min_salary ?? null,
    remote: prefRow?.remote ?? false,
  };

  // --- Load every resume; the matcher scores each job against all of them. -
  const { data: resumeRows } = await supabase
    .from("resumes")
    .select("id,title,content")
    .order("created_at", { ascending: false });

  const resumes = (resumeRows ?? [])
    .map((r) => r as { id: string; title: string; content: string | null })
    .filter((r) => (r.content ?? "").trim().length > 0)
    .map((r) => ({
      id: r.id,
      title: r.title,
      content: r.content ?? "",
      prepared: prepareResume(r.content ?? ""),
    }));

  // --- Fetch every enabled source with bounded concurrency. ----------------
  // Each source is independently timed out and its errors captured, so one slow
  // or broken company never blocks (or fails) the whole scan.
  const sources: AtsSource[] = enabledSources();
  console.log(
    `[scan] start: user=${user.id} sources=${sources.length} ` +
      `concurrency=${SCAN_CONCURRENCY}`,
  );

  const errors: SourceError[] = [];
  const settled = await mapLimit(sources, SCAN_CONCURRENCY, async (s) => {
    try {
      const jobs = await withTimeout(
        fetchSource(s),
        SOURCE_TIMEOUT_MS,
        "timed out",
      );
      console.log(
        `[scan] source ok: ${s.company_name} (${s.ats_type}) jobs=${jobs.length}`,
      );
      return jobs;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[scan] source failed: ${s.company_name} (${s.ats_type}): ${message}`,
      );
      errors.push({ source: s.company_name, error: message });
      throw err; // recorded as a rejected result by mapLimit
    }
  });

  const fetched: DiscoveredJob[] = [];
  let sourcesOk = 0;
  for (const result of settled) {
    if (result.status === "fulfilled") {
      sourcesOk++;
      fetched.push(...result.value);
    }
  }

  if (sourcesOk === 0) {
    console.log(
      `[scan] complete: 0/${sources.length} sources reachable — nothing scanned`,
    );
    return {
      ok: false,
      error: "Could not reach any job sources. Please try again later.",
      summary: {
        sourcesScanned: sources.length,
        sourcesOk: 0,
        jobsDiscovered: 0,
        jobsSaved: 0,
        jobsScored: 0,
        errors,
      },
    };
  }

  // --- Dedup by normalized URL, then narrow by preferences (discovery only).
  const byUrl = new Map<string, DiscoveredJob>();
  for (const job of fetched) {
    const url = normalizeUrl(job.url);
    if (!url) continue;
    if (!byUrl.has(url)) byUrl.set(url, { ...job, url });
  }

  const jobsDiscovered = byUrl.size;
  let candidates = [...byUrl.values()].filter((job) => passesFilter(job, prefs));

  if (candidates.length === 0) {
    console.log(
      `[scan] complete: ${sourcesOk}/${sources.length} sources, ` +
        `${jobsDiscovered} discovered, 0 matched preferences`,
    );
    return {
      ok: true,
      message:
        `Scanned ${sourcesOk} source${sourcesOk === 1 ? "" : "s"} — no jobs ` +
        "matched your discovery preferences. Try broadening roles, locations, or keywords.",
      summary: {
        sourcesScanned: sources.length,
        sourcesOk,
        jobsDiscovered,
        jobsSaved: 0,
        jobsScored: 0,
        errors,
      },
    };
  }

  // Cap the matcher's workload, preferring the most recently posted jobs.
  if (candidates.length > MAX_CANDIDATES) {
    candidates = candidates
      .slice()
      .sort((a, b) => (b.posted_at ?? "").localeCompare(a.posted_at ?? ""))
      .slice(0, MAX_CANDIDATES);
  }

  // --- Score each job against EVERY resume; keep the best resume's match. ---
  const scored = candidates.map((job) => ({
    job,
    match: matchJobToResumes(
      job.title,
      job.company_name,
      job.description,
      resumes,
    ),
  }));

  // Rank by score (nulls last) and keep the top slice.
  scored.sort((a, b) => (b.match.score ?? -1) - (a.match.score ?? -1));
  const keep = scored.slice(0, MAX_STORED);

  // --- Upsert jobs. Conflict on (user_id, url) updates the existing row so a
  //     re-scan refreshes details + score; discovered_at is omitted so the DB
  //     default only stamps it on first insert. -----------------------------
  const jobRows = keep.map(({ job, match }) => ({
    user_id: user.id,
    company_name: job.company_name,
    title: job.title,
    url: job.url,
    source: job.source,
    location: job.location,
    description: job.description,
    posted_at: job.posted_at,
    match_score: match.score,
  }));

  const { data: upserted, error: jobsError } = await supabase
    .from("jobs")
    .upsert(jobRows, { onConflict: "user_id,url" })
    .select("id,url");

  if (jobsError) {
    console.error(`[scan] save failed: ${jobsError.message}`);
    return {
      ok: false,
      error: `Save failed: ${jobsError.message}`,
      summary: {
        sourcesScanned: sources.length,
        sourcesOk,
        jobsDiscovered,
        jobsSaved: 0,
        jobsScored: 0,
        errors,
      },
    };
  }

  const jobsSaved = upserted?.length ?? 0;
  const jobsScored = keep.filter(
    ({ match }) => typeof match.score === "number",
  ).length;

  // --- Upsert the per-job match detail (best resume, keywords, tweaks). -----
  const idByUrl = new Map<string, string>();
  for (const row of upserted ?? []) {
    idByUrl.set((row as { id: string; url: string }).url, (row as { id: string }).id);
  }

  const scoredAt = new Date().toISOString();
  const matchRows = keep
    .map(({ job, match }) => {
      const jobId = idByUrl.get(job.url);
      if (!jobId) return null;
      return {
        user_id: user.id,
        job_id: jobId,
        resume_id: match.bestResumeId,
        best_resume_id: match.bestResumeId,
        best_resume_title: match.bestResumeTitle,
        score: match.score,
        matched_keywords: match.matchedKeywords,
        matched_phrases: match.matchedPhrases,
        missing_keywords: match.missingKeywords,
        resume_tweaks: match.resumeTweaks,
        scored_at: scoredAt,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const summary: ScanSummary = {
    sourcesScanned: sources.length,
    sourcesOk,
    jobsDiscovered,
    jobsSaved,
    jobsScored,
    errors,
  };

  if (matchRows.length > 0) {
    const { error: matchError } = await supabase
      .from("job_matches")
      .upsert(matchRows, { onConflict: "user_id,job_id" });
    // A match-table failure shouldn't lose the discovered jobs — surface it but
    // don't discard the successful job upsert above.
    if (matchError) {
      revalidatePath("/jobs");
      console.log(
        `[scan] complete: ${sourcesOk}/${sources.length} sources, ` +
          `${jobsDiscovered} discovered, ${jobsSaved} saved, ` +
          `match details failed: ${matchError.message}`,
      );
      return {
        ok: true,
        message:
          `Discovered ${keep.length} job${keep.length === 1 ? "" : "s"}, ` +
          `but match details couldn't be saved: ${matchError.message}`,
        summary: { ...summary, jobsScored: 0 },
      };
    }
  }

  revalidatePath("/jobs");
  revalidatePath("/dashboard");

  console.log(
    `[scan] complete: ${sourcesOk}/${sources.length} sources, ` +
      `${jobsDiscovered} discovered, ${jobsSaved} saved, ${jobsScored} scored, ` +
      `${errors.length} error${errors.length === 1 ? "" : "s"}`,
  );

  if (resumes.length === 0) {
    return {
      ok: true,
      message:
        `Scanned ${sourcesOk} source${sourcesOk === 1 ? "" : "s"} · ` +
        `${keep.length} job${keep.length === 1 ? "" : "s"} discovered. ` +
        "Upload a resume to get match scores.",
      summary,
    };
  }

  const top = keep[0].match.score;
  return {
    ok: true,
    message:
      `Scanned ${sourcesOk} source${sourcesOk === 1 ? "" : "s"} · ` +
      `${keep.length} job${keep.length === 1 ? "" : "s"} matched against ` +
      `${resumes.length} resume${resumes.length === 1 ? "" : "s"}` +
      (typeof top === "number" ? ` · best match ${top}%` : ""),
    summary,
  };
}

// ---------------------------------------------------------------------------
// Dismiss / restore
//
// "Dismissing" a job flags its job_matches row as rejected so the Jobs page can
// hide it. The upsert (conflict on user_id, job_id) only touches `status`, so a
// job's score/reasons survive — and it works even for jobs that were never
// scored (it inserts a status-only match row).
// ---------------------------------------------------------------------------

async function setJobStatus(
  formData: FormData,
  status: "rejected" | "new",
): Promise<void> {
  const jobId = String(formData.get("id") ?? "").trim();
  if (!jobId) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const pinned = await pinSession(supabase);
  if (!pinned.ok) return;

  await supabase
    .from("job_matches")
    .upsert(
      { user_id: user.id, job_id: jobId, status },
      { onConflict: "user_id,job_id" },
    );

  revalidatePath("/jobs");
}

export async function dismissJob(formData: FormData): Promise<void> {
  await setJobStatus(formData, "rejected");
}

export async function restoreJob(formData: FormData): Promise<void> {
  await setJobStatus(formData, "new");
}
