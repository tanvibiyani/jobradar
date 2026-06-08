"use client";

import { useActionState } from "react";
import { runJobScan, type ScanState, type ScanSummary } from "./actions";

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function SummaryView({ summary }: { summary: ScanSummary }) {
  return (
    <div className="w-full space-y-2">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        <Stat
          label="Sources scanned"
          value={`${summary.sourcesOk}/${summary.sourcesScanned}`}
        />
        <Stat label="Jobs discovered" value={summary.jobsDiscovered} />
        <Stat label="Jobs saved" value={summary.jobsSaved} />
        <Stat label="Jobs scored" value={summary.jobsScored} />
      </dl>

      {summary.errors.length > 0 ? (
        <details className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          <summary className="cursor-pointer font-medium">
            {summary.errors.length} source
            {summary.errors.length === 1 ? "" : "s"} failed
          </summary>
          <ul className="mt-2 space-y-1">
            {summary.errors.map((e) => (
              <li key={e.source} className="flex justify-between gap-3">
                <span className="font-medium">{e.source}</span>
                <span className="text-amber-700 dark:text-amber-400">
                  {e.error}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export function RunScan() {
  const [state, formAction, pending] = useActionState<ScanState, FormData>(
    runJobScan,
    null,
  );

  const summary = state && "summary" in state ? state.summary : undefined;

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-10 items-center justify-center rounded-md bg-black px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
      >
        {pending ? "Scanning…" : "Run Job Scan"}
      </button>
      <p className="text-xs text-zinc-500">
        Searches public ATS job boards and ranks matches against your
        preferences and resumes.
      </p>

      {state && !pending && "error" in state ? (
        <p
          role="alert"
          className="w-full rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {state.error}
        </p>
      ) : null}

      {state && !pending && "ok" in state && state.ok ? (
        <p
          role="status"
          className="w-full rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300"
        >
          {state.message}
        </p>
      ) : null}

      {summary && !pending ? <SummaryView summary={summary} /> : null}
    </form>
  );
}
