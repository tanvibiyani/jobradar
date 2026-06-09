"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { startJobScan } from "./actions";
import {
  SCAN_STALE_MS,
  type ScanRun,
  type ScanTrigger,
} from "./scan-types";

const POLL_MS = 5_000;

/** A scan still flagged running but older than the stale window is treated as
 * abandoned (e.g. the server restarted mid-scan), so the button frees up. */
function isActivelyRunning(scan: ScanRun | null): boolean {
  if (!scan || scan.status !== "running") return false;
  const started = scan.started_at ? Date.parse(scan.started_at) : 0;
  return Date.now() - started < SCAN_STALE_MS;
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">
        {(value ?? 0).toLocaleString()}
      </dd>
    </div>
  );
}

function CompletedSummary({ scan }: { scan: ScanRun }) {
  return (
    <div className="w-full space-y-2 rounded-md border border-green-300 bg-green-50 px-3 py-2 dark:border-green-900 dark:bg-green-950/40">
      <p className="text-sm font-medium text-green-800 dark:text-green-300">
        Last scan completed
        {scan.completed_at ? ` · ${formatTime(scan.completed_at)}` : ""}
      </p>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        <Stat label="Sources scanned" value={scan.sources_scanned} />
        <Stat label="Jobs found" value={scan.jobs_found} />
        <Stat label="Jobs saved" value={scan.jobs_saved} />
        <Stat label="Jobs scored" value={scan.jobs_scored} />
      </dl>
      {scan.error_message ? (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {scan.error_message}
        </p>
      ) : null}
    </div>
  );
}

export function RunScan({ initialScan }: { initialScan: ScanRun | null }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ScanTrigger, FormData>(
    startJobScan,
    null,
  );
  const [scan, setScan] = useState<ScanRun | null>(initialScan);

  // Sync when the server hands us a newer scan (after revalidate/refresh).
  useEffect(() => {
    setScan(initialScan);
  }, [initialScan]);

  // Poll while a scan is running; refresh the route when it finishes so the
  // newly saved jobs (and dashboard counts) appear without a manual reload.
  useEffect(() => {
    if (!scan || scan.status !== "running") return;
    let active = true;
    const id = setInterval(async () => {
      try {
        const res = await fetch("/api/scan-status", { cache: "no-store" });
        if (!res.ok || !active) return;
        const next = (await res.json()) as { scan: ScanRun | null };
        if (!active) return;
        setScan(next.scan);
        if (!next.scan || next.scan.status !== "running") {
          clearInterval(id);
          router.refresh();
        }
      } catch {
        // transient network error — keep polling
      }
    }, POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [scan?.id, scan?.status, router]);

  const running = pending || isActivelyRunning(scan);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <button
        type="submit"
        disabled={running}
        className="inline-flex h-10 items-center justify-center rounded-md bg-black px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
      >
        {running ? "Scan running…" : "Run Job Scan"}
      </button>
      <p className="text-xs text-zinc-500">
        Searches public ATS job boards in the background and ranks matches
        against your preferences and resumes.
      </p>

      {state && !state.ok ? (
        <p
          role="alert"
          className="w-full rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {state.error}
        </p>
      ) : null}

      {running ? (
        <p
          role="status"
          className="w-full rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300"
        >
          Scanning in the background — this page updates automatically when it
          finishes.
        </p>
      ) : scan && scan.status === "success" ? (
        <CompletedSummary scan={scan} />
      ) : scan && scan.status === "failed" ? (
        <p
          role="alert"
          className="w-full rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          Last scan failed
          {scan.error_message ? `: ${scan.error_message}` : "."}
        </p>
      ) : null}
    </form>
  );
}
