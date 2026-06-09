// Server-only module: imports the service-role Supabase client and runs the
// background scan. Only ever imported by the start-scan server action.
import { createServiceRoleClient } from "@/lib/supabase/server";
import { enabledSources } from "@/lib/ats/sources";
import { fetchSource } from "@/lib/ats/fetchers";
import { passesFilter } from "@/lib/ats/scoring";
import { matchJobToResumes, prepareResume } from "@/lib/ats/match";
import type { AtsSource, DiscoveredJob, Preferences } from "@/lib/ats/types";

// ---------------------------------------------------------------------------
// Background job scan.
//
// `runScanJob` is invoked fire-and-forget by the start-scan server action and
// runs to completion in the background (this app is a long-lived Node process
// under pm2). It uses the SERVICE-ROLE client — there is no request/cookie
// context once the action has returned — and writes with an explicit user_id.
// It always finalizes its scan_runs row (success or failed) so the UI's poll
// never hangs on "running" forever.
// ---------------------------------------------------------------------------

// How many ATS feeds we fetch at once. Bounded so we never open dozens of
// sockets or buffer many multi-MB payloads simultaneously.
const SCAN_CONCURRENCY = 8;
// Max sources scanned per run (for now). Keeps each background run short.
const MAX_SOURCES = 25;
// Hard timeout per source. The fetchers also abort their own HTTP request at
// this bound; this outer guard covers parse/normalize or a wedged socket so one
// company can never stall the run past 10s.
const SOURCE_TIMEOUT_MS = 10_000;
// Cap how many discovered jobs we run the (heavier) resume matcher over.
const MAX_CANDIDATES = 2500;
// After scoring, keep only the best-ranked jobs so a run never writes unbounded.
const MAX_STORED = 500;
// Yield to the event loop every N scored jobs so the (synchronous, CPU-bound)
// scoring loop can't make the rest of the site unresponsive while it runs.
const SCORE_YIELD_EVERY = 200;

type ServiceClient = Awaited<ReturnType<typeof createServiceRoleClient>>;

/** Reject with `label` if `p` hasn't settled within `ms`. */
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
 * Run `fn` over `items` with at most `limit` in flight. Never rejects — each
 * item resolves to a PromiseSettledResult so one bad source can't sink the run.
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
  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return results;
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

/** Mark the run failed; best-effort (logs if even that write fails). */
async function markFailed(
  supabase: ServiceClient,
  scanRunId: string,
  message: string,
): Promise<void> {
  const { error } = await supabase
    .from("scan_runs")
    .update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: message.slice(0, 500),
    })
    .eq("id", scanRunId);
  if (error) {
    console.error(`[scan ${scanRunId}] could not mark failed: ${error.message}`);
  }
}

export async function runScanJob(
  userId: string,
  scanRunId: string,
): Promise<void> {
  const supabase = await createServiceRoleClient();
  const startedAt = Date.now();

  try {
    console.log(`[scan ${scanRunId}] start: user=${userId}`);

    // --- Preferences (default to "no constraints"). ------------------------
    const { data: prefRow } = await supabase
      .from("preferences")
      .select("roles,locations,keywords,min_salary,remote,years_of_experience")
      .eq("user_id", userId)
      .maybeSingle();
    const prefs: Preferences = {
      roles: prefRow?.roles ?? [],
      locations: prefRow?.locations ?? [],
      keywords: prefRow?.keywords ?? [],
      min_salary: prefRow?.min_salary ?? null,
      remote: prefRow?.remote ?? false,
      years_of_experience: prefRow?.years_of_experience ?? null,
    };

    // --- Resumes (the matcher scores each job against all of them). --------
    const { data: resumeRows } = await supabase
      .from("resumes")
      .select("id,title,content")
      .eq("user_id", userId)
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

    // --- Fetch sources (capped) with bounded concurrency + per-source timeout.
    const sources: AtsSource[] = enabledSources().slice(0, MAX_SOURCES);
    console.log(
      `[scan ${scanRunId}] fetching ${sources.length} sources ` +
        `(cap ${MAX_SOURCES}, concurrency ${SCAN_CONCURRENCY}, timeout ${SOURCE_TIMEOUT_MS}ms)`,
    );

    const sourceErrors: string[] = [];
    const settled = await mapLimit(sources, SCAN_CONCURRENCY, async (s) => {
      try {
        const jobs = await withTimeout(
          fetchSource(s),
          SOURCE_TIMEOUT_MS,
          "timed out",
        );
        console.log(
          `[scan ${scanRunId}] source ok: ${s.company_name} (${s.ats_type}) jobs=${jobs.length}`,
        );
        return jobs;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[scan ${scanRunId}] source failed: ${s.company_name} (${s.ats_type}): ${message}`,
        );
        sourceErrors.push(`${s.company_name}: ${message}`);
        throw err; // one failure never stops the others (mapLimit isolates it)
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
      throw new Error("Could not reach any job sources.");
    }

    // --- Dedup by normalized URL, then narrow by preferences. --------------
    const byUrl = new Map<string, DiscoveredJob>();
    for (const job of fetched) {
      const url = normalizeUrl(job.url);
      if (!url) continue;
      if (!byUrl.has(url)) byUrl.set(url, { ...job, url });
    }
    const jobsFound = byUrl.size;

    let candidates = [...byUrl.values()].filter((job) =>
      passesFilter(job, prefs),
    );
    if (candidates.length > MAX_CANDIDATES) {
      candidates = candidates
        .slice()
        .sort((a, b) => (b.posted_at ?? "").localeCompare(a.posted_at ?? ""))
        .slice(0, MAX_CANDIDATES);
    }

    // --- Score each candidate against EVERY resume; yield periodically. ----
    const scored: Array<{
      job: DiscoveredJob;
      match: ReturnType<typeof matchJobToResumes>;
    }> = [];
    for (let i = 0; i < candidates.length; i++) {
      const job = candidates[i];
      scored.push({
        job,
        match: matchJobToResumes(
          job.title,
          job.company_name,
          job.description,
          resumes,
          prefs.years_of_experience,
        ),
      });
      if (i % SCORE_YIELD_EVERY === SCORE_YIELD_EVERY - 1) {
        await new Promise<void>((r) => setImmediate(r));
      }
    }
    scored.sort((a, b) => (b.match.score ?? -1) - (a.match.score ?? -1));
    const keep = scored.slice(0, MAX_STORED);

    // --- Upsert jobs + match details. --------------------------------------
    let jobsSaved = 0;
    let jobsScored = 0;
    if (keep.length > 0) {
      const jobRows = keep.map(({ job, match }) => ({
        user_id: userId,
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
      if (jobsError) throw new Error(`Save failed: ${jobsError.message}`);

      jobsSaved = upserted?.length ?? 0;
      jobsScored = keep.filter(
        ({ match }) => typeof match.score === "number",
      ).length;

      const idByUrl = new Map<string, string>();
      for (const row of upserted ?? []) {
        idByUrl.set(
          (row as { id: string; url: string }).url,
          (row as { id: string }).id,
        );
      }

      const scoredAt = new Date().toISOString();
      const matchRows = keep
        .map(({ job, match }) => {
          const jobId = idByUrl.get(job.url);
          if (!jobId) return null;
          return {
            user_id: userId,
            job_id: jobId,
            resume_id: match.bestResumeId,
            best_resume_id: match.bestResumeId,
            best_resume_title: match.bestResumeTitle,
            score: match.score,
            matched_keywords: match.matchedAtsKeywords,
            matched_phrases: match.matchedExactPhrases,
            matched_responsibilities: match.matchedResponsibilities,
            missing_keywords: match.missingImportantKeywords,
            missing_phrases: match.missingCorePhrases,
            experience_requirement: match.experienceRequirement,
            experience_alignment_reason: match.experienceAlignmentReason,
            match_reason: match.matchReason,
            resume_tweaks: match.resumeTweaks,
            scored_at: scoredAt,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (matchRows.length > 0) {
        const { error: matchError } = await supabase
          .from("job_matches")
          .upsert(matchRows, { onConflict: "user_id,job_id" });
        // A match-detail failure shouldn't lose the discovered jobs.
        if (matchError) {
          console.error(
            `[scan ${scanRunId}] match details failed: ${matchError.message}`,
          );
        }
      }
    }

    // --- Finalize: success (partial source failures are noted, not fatal). -
    const { error: finalizeError } = await supabase
      .from("scan_runs")
      .update({
        status: "success",
        completed_at: new Date().toISOString(),
        sources_scanned: sourcesOk,
        jobs_found: jobsFound,
        jobs_saved: jobsSaved,
        jobs_scored: jobsScored,
        error_message:
          sourceErrors.length > 0
            ? `${sourceErrors.length} source(s) failed: ` +
              sourceErrors.slice(0, 5).join("; ")
            : null,
      })
      .eq("id", scanRunId);
    if (finalizeError) {
      console.error(
        `[scan ${scanRunId}] could not finalize: ${finalizeError.message}`,
      );
    }

    console.log(
      `[scan ${scanRunId}] complete in ${((Date.now() - startedAt) / 1000).toFixed(1)}s: ` +
        `${sourcesOk}/${sources.length} sources, ${jobsFound} found, ` +
        `${jobsSaved} saved, ${jobsScored} scored, ${sourceErrors.length} source errors`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[scan ${scanRunId}] failed: ${message}`);
    await markFailed(supabase, scanRunId, message);
  }
}
