"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { savePreferences, type SaveState } from "./actions";

export type PreferencesDefaults = {
  roles: string[];
  locations: string[];
  keywords: string[];
  min_salary: number | null;
  remote: boolean;
  years_of_experience: number | null;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-10 items-center justify-center rounded-md bg-black px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
    >
      {pending ? "Saving…" : "Save preferences"}
    </button>
  );
}

const inputClass =
  "mt-1 block h-10 w-full rounded-md border border-zinc-300 px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const areaClass =
  "mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

export function PreferencesForm({
  defaults,
}: {
  defaults: PreferencesDefaults;
}) {
  const [state, formAction] = useActionState<SaveState, FormData>(
    savePreferences,
    null,
  );

  return (
    <form
      action={formAction}
      className="space-y-5 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div>
        <label htmlFor="roles" className="block text-sm font-medium">
          Target roles
        </label>
        <textarea
          id="roles"
          name="roles"
          rows={2}
          defaultValue={defaults.roles.join(", ")}
          placeholder="e.g. Senior Software Engineer, Staff Engineer"
          className={areaClass}
        />
        <p className="mt-1 text-xs text-zinc-500">
          Separate multiple roles with commas or new lines.
        </p>
      </div>

      <div>
        <label htmlFor="locations" className="block text-sm font-medium">
          Locations
        </label>
        <textarea
          id="locations"
          name="locations"
          rows={2}
          defaultValue={defaults.locations.join(", ")}
          placeholder="e.g. San Francisco, New York, London"
          className={areaClass}
        />
        <p className="mt-1 text-xs text-zinc-500">
          Separate multiple locations with commas or new lines.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
        <div>
          <label
            htmlFor="years_of_experience"
            className="block text-sm font-medium"
          >
            Years of experience
          </label>
          <input
            id="years_of_experience"
            name="years_of_experience"
            type="number"
            min={0}
            max={60}
            step={1}
            inputMode="numeric"
            defaultValue={defaults.years_of_experience ?? ""}
            placeholder="e.g. 6"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-zinc-500">
            Used to score how well each role&apos;s experience requirement fits
            you. Leave blank to skip experience scoring (scores are then capped
            at 85%).
          </p>
        </div>

        <div>
          <label htmlFor="min_salary" className="block text-sm font-medium">
            Minimum salary
          </label>
          <input
            id="min_salary"
            name="min_salary"
            type="number"
            min={0}
            step={1000}
            inputMode="numeric"
            defaultValue={defaults.min_salary ?? ""}
            placeholder="e.g. 150000"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-zinc-500">
            Annual, in your local currency. Leave blank for no minimum.
          </p>
        </div>

        <div>
          <span className="block text-sm font-medium">Remote</span>
          <label className="mt-1 inline-flex h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="remote"
              defaultChecked={defaults.remote}
              className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700"
            />
            Only show remote-friendly roles
          </label>
        </div>
      </div>

      <div>
        <label htmlFor="keywords" className="block text-sm font-medium">
          Keywords
        </label>
        <textarea
          id="keywords"
          name="keywords"
          rows={2}
          defaultValue={defaults.keywords.join(", ")}
          placeholder="e.g. TypeScript, distributed systems, fintech"
          className={areaClass}
        />
        <p className="mt-1 text-xs text-zinc-500">
          Skills or topics to prioritize. Commas or new lines.
        </p>
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
