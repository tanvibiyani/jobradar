"use client";

import { useActionState, useRef, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { uploadResume, type UploadState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-10 items-center justify-center rounded-md bg-black px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
    >
      {pending ? "Uploading…" : "Upload resume"}
    </button>
  );
}

export function UploadForm() {
  const [state, formAction] = useActionState<UploadState, FormData>(
    uploadResume,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state && "ok" in state && state.ok) {
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-4 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="space-y-3">
          <div>
            <label htmlFor="title" className="block text-sm font-medium">
              Title
            </label>
            <input
              id="title"
              name="title"
              type="text"
              required
              maxLength={200}
              placeholder="e.g. Senior Engineer · 2026"
              className="mt-1 block h-10 w-full rounded-md border border-zinc-300 px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>

          <div>
            <label htmlFor="file" className="block text-sm font-medium">
              PDF file
            </label>
            <input
              id="file"
              name="file"
              type="file"
              accept="application/pdf,.pdf"
              required
              className="mt-1 block w-full cursor-pointer rounded-md border border-zinc-300 px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-zinc-100 file:px-3 file:py-1 file:text-sm file:font-medium hover:file:bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:file:bg-zinc-800 dark:hover:file:bg-zinc-700"
            />
            <p className="mt-1 text-xs text-zinc-500">PDF only, up to 8MB.</p>
          </div>
        </div>

        <SubmitButton />
      </div>

      {state && "error" in state ? (
        <p
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {state.error}
        </p>
      ) : null}

      {state && "ok" in state && state.ok ? (
        <p
          role="status"
          className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300"
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
