"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { runScanJob } from "@/lib/ats/run-scan";
import { SCAN_STALE_MS, type ScanTrigger } from "./scan-types";

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

// ---------------------------------------------------------------------------
// Start scan (trigger only)
//
// Creates a scan_runs row with status "running", kicks the actual scan off in
// the background (NOT awaited — the scan finalizes its own row), and returns
// immediately. The UI polls /api/scan-status for completion. This keeps the
// click responsive and the heavy fetch/score/save work off the request path.
// ---------------------------------------------------------------------------
export async function startJobScan(
  _prev: ScanTrigger,
  _formData: FormData,
): Promise<ScanTrigger> {
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

  // Don't pile up scans (concurrent runs are what made the site unresponsive):
  // if one is already running and not stale, reuse it instead of starting more.
  const cutoff = new Date(Date.now() - SCAN_STALE_MS).toISOString();
  const { data: alreadyRunning } = await supabase
    .from("scan_runs")
    .select("id")
    .eq("status", "running")
    .gte("started_at", cutoff)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (alreadyRunning) {
    return { ok: true, message: "A scan is already running." };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("scan_runs")
    .insert({ user_id: user.id, status: "running" })
    .select("id")
    .single();
  if (insertError || !inserted) {
    return {
      ok: false,
      error: `Could not start scan: ${insertError?.message ?? "unknown error"}`,
    };
  }

  const scanRunId = (inserted as { id: string }).id;

  // Fire-and-forget. We intentionally do NOT await: the scan runs in the
  // background of this long-lived Node process and updates its scan_runs row on
  // completion. The .catch() keeps a crash from becoming an unhandled rejection.
  void runScanJob(user.id, scanRunId).catch((err) => {
    console.error(`[scan ${scanRunId}] background job crashed:`, err);
  });

  // Re-render so the page picks up the new "running" row for the button/poll.
  revalidatePath("/jobs");
  return { ok: true, message: "Scan started." };
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
