"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { runJobScan, type ScanState } from "./actions";

function ScanButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-10 items-center justify-center rounded-md bg-black px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
    >
      {pending ? "Scanning…" : "Run Job Scan"}
    </button>
  );
}

export function RunScan() {
  const [state, formAction] = useActionState<ScanState, FormData>(
    runJobScan,
    null,
  );

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <ScanButton />
      <p className="text-xs text-zinc-500">
        Searches public ATS job boards and ranks matches against your
        preferences and resumes.
      </p>

      {state && "error" in state ? (
        <p
          role="alert"
          className="w-full rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {state.error}
        </p>
      ) : null}

      {state && "ok" in state && state.ok ? (
        <p
          role="status"
          className="w-full rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300"
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
