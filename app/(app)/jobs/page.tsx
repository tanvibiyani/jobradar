import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type JobRow = {
  id: string;
  title: string;
  location: string | null;
  source: string | null;
  apply_url: string | null;
  created_at: string;
  // Embedded company. PostgREST returns the related row (or null) for the
  // jobs.company_id -> companies.id foreign key.
  companies: { name: string } | null;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function JobsPage() {
  const supabase = await createClient();

  // RLS ("jobs select own") restricts this to the signed-in user's rows.
  // `apply_url:url` aliases the table's `url` column to the requested name;
  // `companies(name)` embeds the related company via the company_id FK.
  const { data, error } = await supabase
    .from("jobs")
    .select("id,title,location,source,apply_url:url,created_at,companies(name)")
    .order("created_at", { ascending: false });

  const jobs = (data ?? []) as unknown as JobRow[];

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 font-sans">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Postings you&apos;re tracking, newest first.
        </p>
      </header>

      {error ? (
        <p
          role="alert"
          className="mt-6 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          Could not load jobs: {error.message}
        </p>
      ) : null}

      <section className="mt-8">
        {jobs.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
            No jobs yet. Jobs you track will appear here.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Location</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Apply</th>
                  <th className="px-4 py-3 font-medium">Added</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td className="px-4 py-3 font-medium">{j.title}</td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {j.companies?.name ?? (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {j.location ?? <span className="text-zinc-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {j.source ?? <span className="text-zinc-400">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {j.apply_url ? (
                        <a
                          href={
                            /^https?:\/\//i.test(j.apply_url)
                              ? j.apply_url
                              : `https://${j.apply_url}`
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline dark:text-blue-400"
                        >
                          Apply
                        </a>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {formatDate(j.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
