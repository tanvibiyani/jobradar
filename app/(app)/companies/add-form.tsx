"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { addCompany, type SaveState } from "./actions";

const inputClass =
  "mt-1 block h-10 w-full rounded-md border border-zinc-300 px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-10 items-center justify-center rounded-md bg-black px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
    >
      {pending ? "Adding…" : "Add company"}
    </button>
  );
}

export function AddCompanyForm() {
  const [state, formAction] = useActionState<SaveState, FormData>(
    addCompany,
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
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className="block text-sm font-medium">
            Company name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            maxLength={200}
            placeholder="e.g. Acme Inc."
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="website" className="block text-sm font-medium">
            Website
          </label>
          <input
            id="website"
            name="website"
            type="url"
            placeholder="https://acme.com"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="careers_url" className="block text-sm font-medium">
            Career page URL
          </label>
          <input
            id="careers_url"
            name="careers_url"
            type="url"
            placeholder="https://acme.com/careers"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="notes" className="block text-sm font-medium">
            Notes
          </label>
          <input
            id="notes"
            name="notes"
            type="text"
            maxLength={500}
            placeholder="Anything worth remembering"
            className={inputClass}
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <SubmitButton />

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
      </div>
    </form>
  );
}
