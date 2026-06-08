import { createClient } from "@/lib/supabase/server";
import { PreferencesForm, type PreferencesDefaults } from "./preferences-form";

export const dynamic = "force-dynamic";

type PreferencesRow = {
  roles: string[] | null;
  locations: string[] | null;
  keywords: string[] | null;
  min_salary: number | null;
  remote: boolean | null;
};

const EMPTY: PreferencesDefaults = {
  roles: [],
  locations: [],
  keywords: [],
  min_salary: null,
  remote: false,
};

export default async function PreferencesPage() {
  const supabase = await createClient();

  // RLS ("preferences select own") restricts this to the signed-in user's row,
  // so `.maybeSingle()` returns their preferences or null if not yet set.
  const { data, error } = await supabase
    .from("preferences")
    .select("roles,locations,keywords,min_salary,remote")
    .maybeSingle<PreferencesRow>();

  const defaults: PreferencesDefaults = data
    ? {
        roles: data.roles ?? [],
        locations: data.locations ?? [],
        keywords: data.keywords ?? [],
        min_salary: data.min_salary,
        remote: data.remote ?? false,
      }
    : EMPTY;

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 font-sans">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Job preferences
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Tell us what you&apos;re looking for. We use these to score and surface
          matching roles.
        </p>
      </header>

      {error ? (
        <p
          role="alert"
          className="mt-6 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          Could not load preferences: {error.message}
        </p>
      ) : null}

      <section className="mt-8">
        <PreferencesForm defaults={defaults} />
      </section>
    </main>
  );
}
