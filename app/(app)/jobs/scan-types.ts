// Shared scan types. Kept in a plain module (no "use server"/"use client")
// so the server action, the polling route handler, the background job, and the
// client button can all import them without pulling in each other's runtime.

export type ScanStatus = "running" | "success" | "failed";

/** A row from public.scan_runs, as surfaced to the UI. */
export type ScanRun = {
  id: string;
  status: ScanStatus;
  started_at: string | null;
  completed_at: string | null;
  sources_scanned: number | null;
  jobs_found: number | null;
  jobs_saved: number | null;
  jobs_scored: number | null;
  error_message: string | null;
};

/** Result of the start-scan server action (trigger only — not the scan itself). */
export type ScanTrigger =
  | { ok: true; message: string }
  | { ok: false; error: string }
  | null;

/** Columns to select for a ScanRun. Shared by the page and the poll route. */
export const SCAN_RUN_COLUMNS =
  "id,status,started_at,completed_at,sources_scanned,jobs_found,jobs_saved,jobs_scored,error_message";

// A scan whose row still says "running" after this long is treated as
// abandoned (e.g. the server restarted mid-scan): the start action will allow a
// new scan, and the button stops showing "Scan running…".
export const SCAN_STALE_MS = 5 * 60_000;
