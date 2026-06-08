import { createClient } from "@/lib/supabase/server";
import { RunScan } from "./scan-button";

export const dynamic = "force-dynamic";

type MatchReasons = {
  summary?: string;
  notes?: string[];
};

type JobRow = {
  id: string;
  title: string;
  company_name: string | null;
  location: string | null;
  source: string | null;
  apply_url: string | null;
  match_score: number | null;
  discovered_at: string | null;
  created_at: string;
  // Legacy manually-tracked jobs link to a company via company_id; discovered
  // jobs carry company_name directly. We fall back to the embedded company.
  companies: { name: string } | null;
  // The scoring breakdown for this job, embedded from job_matches via its
  // job_id FK. One row per job (unique on user_id, job_id) or empty for
  // legacy jobs that were never scored.
  job_matches: { reasons: MatchReasons | null }[] | null;
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
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

function ScoreBadge({
  score,
  breakdown,
}: {
  score: number | null;
  breakdown?: string;
}) {
  if (score === null) return <span className="text-zinc-400">—</span>;
  const tone =
    score >= 60
      ? "bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300"
      : score >= 30
        ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
        : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
  return (
    <span
      title={breakdown}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      {score}%
    </span>
  );
}

export default async function JobsPage() {
  const supabase = await createClient();

  // RLS ("jobs select own") restricts this to the signed-in user's rows.
  // Rank by match score (best first, unscored last), then by recency.
  const { data, error } = await supabase
    .from("jobs")
    .select(
      "id,title,company_name,location,source,apply_url:url,match_score,discovered_at,created_at,companies(name),job_matches(reasons)",
    )
    .order("match_score", { ascending: false, nullsFirst: false })
    .order("discovered_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  const jobs = (data ?? []) as unknown as JobRow[];

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 font-sans">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Discovered across public job boards and ranked by how well they match
          you.
        </p>
      </header>

      <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <RunScan />
      </section>

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
            No jobs yet. Set your{" "}
            <a href="/preferences" className="text-blue-600 hover:underline dark:text-blue-400">
              preferences
            </a>{" "}
            and click <span className="font-medium">Run Job Scan</span> to
            discover matches.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Match</th>
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Location</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Apply</th>
                  <th className="px-4 py-3 font-medium">Discovered</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {jobs.map((j) => {
                  const reasons = j.job_matches?.[0]?.reasons ?? null;
                  const why = reasons?.notes?.length
                    ? reasons.notes.join(" · ")
                    : null;
                  return (
                  <tr key={j.id}>
                    <td className="px-4 py-3 align-top">
                      <ScoreBadge
                        score={j.match_score}
                        breakdown={reasons?.summary}
                      />
                    </td>
                    <td className="px-4 py-3 align-top font-medium">
                      {j.title}
                      {why ? (
                        <span className="mt-0.5 block text-xs font-normal text-zinc-500 dark:text-zinc-400">
                          {why}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {j.company_name ?? j.companies?.name ?? (
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
                      {formatDate(j.discovered_at ?? j.created_at)}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
