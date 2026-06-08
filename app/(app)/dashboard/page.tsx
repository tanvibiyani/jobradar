import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Count rows for the signed-in user without transferring any. `head: true`
 * issues a HEAD request and `count: "exact"` returns the total via the
 * Content-Range header — so a card showing "1,240 jobs" never pulls 1,240 rows.
 * RLS scopes every count to the current user.
 */
async function countOf(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: "resumes" | "companies" | "jobs" | "job_matches",
): Promise<number> {
  const { count } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true });
  return count ?? 0;
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Counts only — cheap, and all four run in parallel.
  const [resumes, companies, jobs, matches] = await Promise.all([
    countOf(supabase, "resumes"),
    countOf(supabase, "companies"),
    countOf(supabase, "jobs"),
    countOf(supabase, "job_matches"),
  ]);

  const cards = [
    { label: "Resumes", value: resumes },
    { label: "Companies", value: companies },
    { label: "Jobs", value: jobs },
    { label: "Matches", value: matches },
  ];

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 font-sans">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Signed in as <span className="font-medium">{user?.email}</span>.
      </p>

      <section className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{c.label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {c.value.toLocaleString()}
            </p>
          </div>
        ))}
      </section>
    </main>
  );
}
