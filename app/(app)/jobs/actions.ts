"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { SEED_SOURCES } from "@/lib/ats/sources";
import { fetchSource } from "@/lib/ats/fetchers";
import { passesFilter, scoreJob } from "@/lib/ats/scoring";
import type { DiscoveredJob, Preferences } from "@/lib/ats/types";

export type ScanState =
  | { ok: true; message: string }
  | { error: string }
  | null;

// Keep a single scan bounded. After scoring we keep the best-ranked jobs so a
// preference-free profile doesn't dump thousands of rows into the table.
const MAX_STORED = 300;
const MAX_RESUME_CHARS = 40_000;

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
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return { error: "You must be signed in to run a job scan." };
  }

  const pinned = await pinSession(supabase);
  if (!pinned.ok) return { error: pinned.error };

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

  // --- Load resume text for overlap scoring. -------------------------------
  const { data: resumeRows } = await supabase
    .from("resumes")
    .select("content")
    .order("created_at", { ascending: false });

  const resumeText = (resumeRows ?? [])
    .map((r) => (r as { content: string | null }).content ?? "")
    .join("\n")
    .slice(0, MAX_RESUME_CHARS);

  // --- Fetch every seed source concurrently; tolerate individual failures. -
  const settled = await Promise.allSettled(SEED_SOURCES.map((s) => fetchSource(s)));

  const fetched: DiscoveredJob[] = [];
  let sourcesOk = 0;
  for (const result of settled) {
    if (result.status === "fulfilled") {
      sourcesOk++;
      fetched.push(...result.value);
    }
  }

  if (sourcesOk === 0) {
    return { error: "Could not reach any job sources. Please try again later." };
  }

  // --- Dedup by normalized URL, filter, and score. -------------------------
  const byUrl = new Map<string, DiscoveredJob>();
  for (const job of fetched) {
    const url = normalizeUrl(job.url);
    if (!url) continue;
    if (!byUrl.has(url)) byUrl.set(url, { ...job, url });
  }

  const scored = [];
  for (const job of byUrl.values()) {
    if (!passesFilter(job, prefs)) continue;
    const match = scoreJob(job, prefs, resumeText);
    scored.push({ job, match });
  }

  if (scored.length === 0) {
    return {
      ok: true,
      message:
        `Scanned ${sourcesOk} source${sourcesOk === 1 ? "" : "s"} — no jobs ` +
        "matched your preferences. Try broadening your roles, locations, or keywords.",
    };
  }

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

  if (jobsError) return { error: `Save failed: ${jobsError.message}` };

  // --- Upsert per-job match rows (score + reasons) into job_matches. --------
  const idByUrl = new Map<string, string>();
  for (const row of upserted ?? []) {
    idByUrl.set((row as { id: string; url: string }).url, (row as { id: string }).id);
  }

  const matchRows = keep
    .map(({ job, match }) => {
      const jobId = idByUrl.get(job.url);
      if (!jobId) return null;
      return {
        user_id: user.id,
        job_id: jobId,
        score: match.score,
        reasons: match.reasons,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (matchRows.length > 0) {
    const { error: matchError } = await supabase
      .from("job_matches")
      .upsert(matchRows, { onConflict: "user_id,job_id" });
    // A match-table failure shouldn't lose the discovered jobs — surface it but
    // don't discard the successful job upsert above.
    if (matchError) {
      revalidatePath("/jobs");
      return {
        ok: true,
        message:
          `Discovered ${keep.length} matching job${keep.length === 1 ? "" : "s"}, ` +
          `but scoring couldn't be saved: ${matchError.message}`,
      };
    }
  }

  revalidatePath("/jobs");
  revalidatePath("/dashboard");

  const top = keep[0].match.score;
  return {
    ok: true,
    message:
      `Scanned ${sourcesOk} source${sourcesOk === 1 ? "" : "s"} · ` +
      `${keep.length} matching job${keep.length === 1 ? "" : "s"}` +
      (typeof top === "number" ? ` · best match ${top}%` : ""),
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
