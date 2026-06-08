"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  updateCompany,
  deleteCompany,
  type SaveState,
} from "./actions";

export type Company = {
  id: string;
  name: string;
  website: string | null;
  careers_url: string | null;
  notes: string | null;
};

const inputClass =
  "block h-9 w-full rounded-md border border-zinc-300 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

/** Render a stored URL as a clickable link, tolerating a missing scheme. */
function LinkCell({ url, label }: { url: string | null; label: string }) {
  if (!url) return <span className="text-zinc-400">—</span>;
  const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 hover:underline dark:text-blue-400"
    >
      {label}
    </a>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-8 items-center justify-center rounded-md bg-black px-3 text-xs font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
    >
      {pending ? "Saving…" : "Save"}
    </button>
  );
}

function DeleteButton({ name }: { name: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(e) => {
        if (!confirm(`Delete "${name}"? This cannot be undone.`)) {
          e.preventDefault();
        }
      }}
      className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-300 px-3 text-xs font-medium text-zinc-700 transition-colors hover:bg-red-50 hover:text-red-700 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-red-950/40 dark:hover:text-red-400"
    >
      {pending ? "Deleting…" : "Delete"}
    </button>
  );
}

export function CompanyRow({ company }: { company: Company }) {
  const [editing, setEditing] = useState(false);
  const [state, formAction] = useActionState<SaveState, FormData>(
    updateCompany,
    null,
  );

  // Collapse back to display mode once a save succeeds.
  useEffect(() => {
    if (state && "ok" in state && state.ok) {
      setEditing(false);
    }
  }, [state]);

  if (editing) {
    return (
      <tr className="align-top">
        <td colSpan={5} className="px-4 py-3">
          <form action={formAction} className="space-y-3">
            <input type="hidden" name="id" value={company.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Company name
                <input
                  name="name"
                  type="text"
                  required
                  maxLength={200}
                  defaultValue={company.name}
                  className={`mt-1 ${inputClass}`}
                />
              </label>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Website
                <input
                  name="website"
                  type="url"
                  defaultValue={company.website ?? ""}
                  placeholder="https://…"
                  className={`mt-1 ${inputClass}`}
                />
              </label>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Career page URL
                <input
                  name="careers_url"
                  type="url"
                  defaultValue={company.careers_url ?? ""}
                  placeholder="https://…/careers"
                  className={`mt-1 ${inputClass}`}
                />
              </label>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Notes
                <input
                  name="notes"
                  type="text"
                  maxLength={500}
                  defaultValue={company.notes ?? ""}
                  className={`mt-1 ${inputClass}`}
                />
              </label>
            </div>

            <div className="flex items-center gap-3">
              <SaveButton />
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-300 px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Cancel
              </button>
              {state && "error" in state ? (
                <span role="alert" className="text-xs text-red-700 dark:text-red-400">
                  {state.error}
                </span>
              ) : null}
            </div>
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="px-4 py-3 font-medium">{company.name}</td>
      <td className="px-4 py-3">
        <LinkCell url={company.website} label="Website" />
      </td>
      <td className="px-4 py-3">
        <LinkCell url={company.careers_url} label="Careers" />
      </td>
      <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
        {company.notes ? (
          <span className="line-clamp-2">{company.notes}</span>
        ) : (
          <span className="text-zinc-400">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-300 px-3 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Edit
          </button>
          <form action={deleteCompany}>
            <input type="hidden" name="id" value={company.id} />
            <DeleteButton name={company.name} />
          </form>
        </div>
      </td>
    </tr>
  );
}
