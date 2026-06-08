"use client";

import { useFormStatus } from "react-dom";
import { deleteResume } from "./actions";

function DeleteButton({ title }: { title: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(e) => {
        if (!confirm(`Delete "${title}"? This cannot be undone.`)) {
          e.preventDefault();
        }
      }}
      className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-300 px-3 text-xs font-medium text-zinc-700 transition-colors hover:bg-red-50 hover:text-red-700 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-red-950/40 dark:hover:text-red-400"
    >
      {pending ? "Deleting…" : "Delete"}
    </button>
  );
}

export function DeleteForm({ id, title }: { id: string; title: string }) {
  return (
    <form action={deleteResume}>
      <input type="hidden" name="id" value={id} />
      <DeleteButton title={title} />
    </form>
  );
}
