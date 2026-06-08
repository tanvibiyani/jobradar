import { createClient } from "@/lib/supabase/server";
import { RunScan } from "./scan-button";
import { JobFilters, type JobFilterValues } from "./filters";
import { dismissJob, restoreJob } from "./actions";

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
  // Scoring + triage state for this job, embedded from job_matches via its
  // job_id FK. One row per job (unique on user_id, job_id) or empty for legacy
  // jobs that were never scored.
  job_matches: { reasons: MatchReasons | null; status: string | null }[] | null;
};

/** searchParams values arrive as string | string[]; take the first scalar. */
function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** Strip characters that have meaning in PostgREST filter syntax. */
function safeLike(value: string): string {
  return value.replace(/[%,()*]/g, " ").trim().slice(0, 100);
}

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

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();

  // --- Parse filter state out of the URL. ----------------------------------
  const isSubmitted = first(sp.filtered) === "1";
  const minRaw = first(sp.min).trim();
  const minScore = minRaw === "" ? null : Number.parseInt(minRaw, 10);
  const company = first(sp.company).trim();
  const source = first(sp.source).trim();
  const location = safeLike(first(sp.location));
  const q = safeLike(first(sp.q));
  const sort = first(sp.sort) === "newest" ? "newest" : "match";
  // "Hide dismissed" defaults ON; once the form is submitted, honor the box.
  const hideDismissed = isSubmitted ? first(sp.hide_dismissed) === "1" : true;

  const values: JobFilterValues = {
    min: minRaw,
    company,
    source,
    location: first(sp.location).trim().slice(0, 100),
    q: first(sp.q).trim().slice(0, 100),
    sort,
    hideDismissed,
  };

  const filtersActive =
    minScore !== null ||
    company !== "" ||
    source !== "" ||
    location !== "" ||
    q !== "" ||
    sort !== "match" ||
    (isSubmitted && !hideDismissed);

  // --- Facet options (distinct companies/sources across all the user's jobs).
  const { data: facetData } = await supabase
    .from("jobs")
    .select("company_name,source");
  const companies = [
    ...new Set(
      (facetData ?? [])
        .map((r) => (r as { company_name: string | null }).company_name)
        .filter((c): c is string => !!c),
    ),
  ].sort((a, b) => a.localeCompare(b));
  const sources = [
    ...new Set(
      (facetData ?? [])
        .map((r) => (r as { source: string | null }).source)
        .filter((s): s is string => !!s),
    ),
  ].sort((a, b) => a.localeCompare(b));

  // --- Build the filtered, sorted query. -----------------------------------
  // RLS ("jobs select own") restricts this to the signed-in user's rows.
  let query = supabase
    .from("jobs")
    .select(
      "id,title,company_name,location,source,apply_url:url,match_score,discovered_at,created_at,companies(name),job_matches(reasons,status)",
    );

  if (minScore !== null && !Number.isNaN(minScore)) {
    query = query.gte("match_score", minScore);
  }
  if (company) query = query.eq("company_name", company);
  if (source) query = query.eq("source", source);
  if (location) query = query.ilike("location", `%${location}%`);
  if (q) query = query.ilike("title", `%${q}%`);

  if (sort === "newest") {
    query = query
      .order("discovered_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
  } else {
    query = query
      .order("match_score", { ascending: false, nullsFirst: false })
      .order("discovered_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
  }

  const { data, error } = await query;
  let jobs = (data ?? []) as unknown as JobRow[];

  // "Hide dismissed" filters on the embedded job_matches.status. We do it here
  // (rather than in PostgREST) because excluding a *parent* by a child column
  // needs an inner join + negation that's clumsier than a small in-memory pass.
  if (hideDismissed) {
    jobs = jobs.filter((j) => j.job_matches?.[0]?.status !== "rejected");
  }

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

      <section className="mt-6">
        <JobFilters
          values={values}
          companies={companies}
          sources={sources}
          active={filtersActive}
        />
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
          filtersActive ? (
            <p className="rounded-md border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
              No jobs match your filters.{" "}
              <a href="/jobs" className="text-blue-600 hover:underline dark:text-blue-400">
                Clear filters
              </a>
              .
            </p>
          ) : (
            <p className="rounded-md border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
              No jobs yet. Set your{" "}
              <a href="/preferences" className="text-blue-600 hover:underline dark:text-blue-400">
                preferences
              </a>{" "}
              and click <span className="font-medium">Run Job Scan</span> to
              discover matches.
            </p>
          )
        ) : (
          <>
            <p className="mb-3 text-xs text-zinc-500">
              {jobs.length} job{jobs.length === 1 ? "" : "s"}
            </p>
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
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {jobs.map((j) => {
                    const match = j.job_matches?.[0] ?? null;
                    const reasons = match?.reasons ?? null;
                    const why = reasons?.notes?.length
                      ? reasons.notes.join(" · ")
                      : null;
                    const dismissed = match?.status === "rejected";
                    return (
                      <tr key={j.id} className={dismissed ? "opacity-60" : undefined}>
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
                        <td className="px-4 py-3 align-top text-zinc-600 dark:text-zinc-400">
                          {j.company_name ?? j.companies?.name ?? (
                            <span className="text-zinc-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top text-zinc-600 dark:text-zinc-400">
                          {j.location ?? <span className="text-zinc-400">—</span>}
                        </td>
                        <td className="px-4 py-3 align-top text-zinc-600 dark:text-zinc-400">
                          {j.source ?? <span className="text-zinc-400">—</span>}
                        </td>
                        <td className="px-4 py-3 align-top">
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
                        <td className="px-4 py-3 align-top text-zinc-600 dark:text-zinc-400">
                          {formatDate(j.discovered_at ?? j.created_at)}
                        </td>
                        <td className="px-4 py-3 align-top text-right">
                          <form action={dismissed ? restoreJob : dismissJob}>
                            <input type="hidden" name="id" value={j.id} />
                            <button
                              type="submit"
                              className="text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                            >
                              {dismissed ? "Restore" : "Dismiss"}
                            </button>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
