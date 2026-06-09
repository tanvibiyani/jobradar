import { createClient } from "@/lib/supabase/server";
import { RunScan } from "./scan-button";
import { JobFilters, type JobFilterValues } from "./filters";
import { dismissJob, restoreJob } from "./actions";
import { SCAN_RUN_COLUMNS, type ScanRun } from "./scan-types";

export const dynamic = "force-dynamic";

const DEFAULT_MIN = 50; // hide jobs below this match score unless asked otherwise
const PAGE_SIZE = 25; // jobs listed per page; keeps each render bounded

type JobMatch = {
  score: number | null;
  status: string | null;
  best_resume_title: string | null;
  matched_keywords: string[] | null;
  matched_phrases: string[] | null;
  matched_responsibilities: string[] | null;
  missing_keywords: string[] | null;
  missing_phrases: string[] | null;
  experience_requirement: string | null;
  experience_alignment_reason: string | null;
  match_reason: string | null;
  resume_tweaks: string[] | null;
};

// Fit buckets. Order matters — jobs render grouped in this order. Below 50% is
// hidden by default (shown only when the "below 50%" toggle is on).
const BUCKETS = [
  {
    key: "strong",
    label: "Strong Fit",
    sub: "90%+",
    min: 90,
    headerClass: "text-emerald-700 dark:text-emerald-400",
  },
  {
    key: "good",
    label: "Good Fit",
    sub: "75–89%",
    min: 75,
    headerClass: "text-green-700 dark:text-green-400",
  },
  {
    key: "possible",
    label: "Possible Fit",
    sub: "50–74%",
    min: 50,
    headerClass: "text-amber-700 dark:text-amber-400",
  },
  {
    key: "below",
    label: "Below 50%",
    sub: "shown because the toggle is on",
    min: 0,
    headerClass: "text-zinc-500",
  },
] as const;

function bucketFor(score: number | null): (typeof BUCKETS)[number]["key"] {
  const s = score ?? 0;
  if (s >= 90) return "strong";
  if (s >= 75) return "good";
  if (s >= 50) return "possible";
  return "below";
}

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
  companies: { name: string } | null;
  job_matches: JobMatch[] | null;
};

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

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
  });
}

function applyHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <span className="inline-flex h-9 min-w-[3.25rem] items-center justify-center rounded-md bg-zinc-100 px-2 text-sm font-semibold text-zinc-400 dark:bg-zinc-800">
        —
      </span>
    );
  }
  const standout = score >= 90;
  const tone = standout
    ? "bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-300 dark:ring-emerald-700"
    : score >= 70
      ? "bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300"
      : score >= 50
        ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
        : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
  return (
    <span
      className={`inline-flex h-9 min-w-[3.25rem] items-center justify-center gap-0.5 rounded-md px-2 text-sm font-semibold ${tone}`}
    >
      {standout ? <span aria-hidden>★</span> : null}
      {score}%
    </span>
  );
}

function Chips({
  items,
  tone,
  max,
}: {
  items: string[];
  tone: "match" | "miss";
  max?: number;
}) {
  if (!items.length) return null;
  const shown = max ? items.slice(0, max) : items;
  const extra = max ? items.length - shown.length : 0;
  const cls =
    tone === "match"
      ? "bg-green-50 text-green-700 ring-green-200 dark:bg-green-950/40 dark:text-green-300 dark:ring-green-900"
      : "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900";
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((t) => (
        <span
          key={t}
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${cls}`}
        >
          {t}
        </span>
      ))}
      {extra > 0 ? (
        <span className="inline-flex items-center px-1 text-xs text-zinc-500">
          +{extra} more
        </span>
      ) : null}
    </div>
  );
}

function JobCard({ job }: { job: JobRow }) {
  const m = job.job_matches?.[0] ?? null;
  const company = job.company_name ?? job.companies?.name ?? null;
  const matchedPhrases = m?.matched_phrases ?? [];
  const matchedKeywords = m?.matched_keywords ?? [];
  const matchedResponsibilities = m?.matched_responsibilities ?? [];
  const missingKeywords = m?.missing_keywords ?? [];
  const missingPhrases = m?.missing_phrases ?? [];
  const tweaks = m?.resume_tweaks ?? [];
  const experienceReq = m?.experience_requirement ?? null;
  const experienceReason = m?.experience_alignment_reason ?? null;
  const matchReason = m?.match_reason ?? null;
  const dismissed = m?.status === "rejected";
  const standout = (job.match_score ?? 0) >= 90;
  const hasDetails =
    matchedPhrases.length > 0 ||
    matchedKeywords.length > 0 ||
    matchedResponsibilities.length > 0 ||
    missingKeywords.length > 0 ||
    missingPhrases.length > 0 ||
    tweaks.length > 0;

  return (
    <article
      className={`rounded-lg border p-4 ${dismissed ? "opacity-60 " : ""}${
        standout
          ? "border-emerald-300 bg-emerald-50/40 shadow-sm dark:border-emerald-800 dark:bg-emerald-950/20"
          : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <ScoreBadge score={job.match_score} />
          <div className="min-w-0">
            <h3 className="font-medium leading-tight">{job.title}</h3>
            <p className="mt-0.5 truncate text-sm text-zinc-600 dark:text-zinc-400">
              {[company, job.location, job.source].filter(Boolean).join(" · ") ||
                "—"}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          {job.apply_url ? (
            <a
              href={applyHref(job.apply_url)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-300 px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Apply
            </a>
          ) : null}
          <p className="mt-1 text-xs text-zinc-500">
            {formatDate(job.discovered_at ?? job.created_at)}
          </p>
        </div>
      </div>

      {matchReason ? (
        <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">
          {matchReason}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
        {m?.best_resume_title ? (
          <span>
            Best resume:{" "}
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {m.best_resume_title}
            </span>
          </span>
        ) : null}
        {experienceReq ? <span>Experience asked: {experienceReq}</span> : null}
      </div>

      {experienceReason ? (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            Experience alignment:
          </span>{" "}
          {experienceReason}
        </p>
      ) : null}

      {matchedPhrases.length > 0 || matchedKeywords.length > 0 ? (
        <div className="mt-2">
          <Chips
            items={[...matchedPhrases, ...matchedKeywords]}
            tone="match"
            max={10}
          />
        </div>
      ) : null}

      {hasDetails ? (
        <details className="group mt-3">
          <summary className="cursor-pointer list-none text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">
            <span className="group-open:hidden">
              Show match details &amp; resume tweaks ▾
            </span>
            <span className="hidden group-open:inline">
              Hide match details ▴
            </span>
          </summary>

          <div className="mt-3 space-y-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
            {matchedResponsibilities.length > 0 ? (
              <div>
                <p className="mb-1 text-xs font-medium text-zinc-500">
                  Core responsibilities your resume covers
                </p>
                <ul className="list-disc space-y-0.5 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
                  {matchedResponsibilities.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {matchedPhrases.length > 0 ? (
              <div>
                <p className="mb-1 text-xs font-medium text-zinc-500">
                  Matched phrases
                </p>
                <Chips items={matchedPhrases} tone="match" />
              </div>
            ) : null}

            {matchedKeywords.length > 0 ? (
              <div>
                <p className="mb-1 text-xs font-medium text-zinc-500">
                  Matched ATS keywords
                </p>
                <Chips items={matchedKeywords} tone="match" />
              </div>
            ) : null}

            {missingPhrases.length > 0 ? (
              <div>
                <p className="mb-1 text-xs font-medium text-zinc-500">
                  Key phrases missing from your resume
                </p>
                <Chips items={missingPhrases} tone="miss" />
              </div>
            ) : null}

            {missingKeywords.length > 0 ? (
              <div>
                <p className="mb-1 text-xs font-medium text-zinc-500">
                  Missing ATS keywords
                </p>
                <Chips items={missingKeywords} tone="miss" />
              </div>
            ) : null}

            {tweaks.length > 0 ? (
              <div>
                <p className="mb-1 text-xs font-medium text-zinc-500">
                  Suggested resume tweaks
                </p>
                <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
                  {tweaks.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}

      <div className="mt-3 flex justify-end">
        <form action={dismissed ? restoreJob : dismissJob}>
          <input type="hidden" name="id" value={job.id} />
          <button
            type="submit"
            className="text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            {dismissed ? "Restore" : "Dismiss"}
          </button>
        </form>
      </div>
    </article>
  );
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();

  // Latest scan run drives the button state + background-scan polling. This is
  // a cheap single-row read — no scanning or scoring happens on page load.
  const { data: latestScanRow } = await supabase
    .from("scan_runs")
    .select(SCAN_RUN_COLUMNS)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const latestScan = (latestScanRow ?? null) as ScanRun | null;

  // --- Parse filter state out of the URL. ----------------------------------
  const isSubmitted = first(sp.filtered) === "1";
  const minRaw = first(sp.min).trim();
  const userMin = minRaw === "" ? 0 : Number.parseInt(minRaw, 10);
  const company = first(sp.company).trim();
  const source = first(sp.source).trim();
  const location = safeLike(first(sp.location));
  const q = safeLike(first(sp.q));
  const sort = first(sp.sort) === "newest" ? "newest" : "match";
  const hideDismissed = isSubmitted ? first(sp.hide_dismissed) === "1" : true;
  const includeBelow50 = first(sp.below50) === "1";
  const pageRaw = Number.parseInt(first(sp.page), 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  // Hide below 50% by default; the floor drops to 0 when the user opts in.
  const floor = includeBelow50 ? 0 : DEFAULT_MIN;
  const effectiveMin = Math.max(Number.isNaN(userMin) ? 0 : userMin, floor);

  const values: JobFilterValues = {
    min: minRaw,
    company,
    source,
    location: first(sp.location).trim().slice(0, 100),
    q: first(sp.q).trim().slice(0, 100),
    sort,
    hideDismissed,
    includeBelow50,
  };

  const filtersActive =
    company !== "" ||
    source !== "" ||
    location !== "" ||
    q !== "" ||
    sort !== "match" ||
    includeBelow50 ||
    (Number.isFinite(userMin) && userMin > 0) ||
    (isSubmitted && !hideDismissed);

  // --- Facet options (distinct companies/sources across the user's jobs). ---
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

  // When hiding dismissed jobs, exclude them in the DATABASE (not after fetch)
  // so pagination and totals stay correct. Dismissed jobs are typically few, so
  // a lightweight id lookup (indexed by user_id+status) is cheap.
  let rejectedIds: string[] = [];
  if (hideDismissed) {
    const { data: rejectedRows } = await supabase
      .from("job_matches")
      .select("job_id")
      .eq("status", "rejected");
    rejectedIds = (rejectedRows ?? []).map(
      (r) => (r as { job_id: string }).job_id,
    );
  }

  // --- Build the filtered, sorted, paginated query. ------------------------
  // `count: "exact"` returns the total matching rows so we can show page X of Y
  // while `.range()` only transfers the current page (≤ PAGE_SIZE rows). The
  // heavy match arrays are therefore loaded for at most PAGE_SIZE jobs.
  let query = supabase
    .from("jobs")
    .select(
      "id,title,company_name,location,source,apply_url:url,match_score,discovered_at,created_at,companies(name),job_matches(score,status,best_resume_title,matched_keywords,matched_phrases,matched_responsibilities,missing_keywords,missing_phrases,experience_requirement,experience_alignment_reason,match_reason,resume_tweaks)",
      { count: "exact" },
    );

  if (effectiveMin > 0) query = query.gte("match_score", effectiveMin);
  if (company) query = query.eq("company_name", company);
  if (source) query = query.eq("source", source);
  if (location) query = query.ilike("location", `%${location}%`);
  if (q) query = query.ilike("title", `%${q}%`);
  if (rejectedIds.length > 0) {
    query = query.not("id", "in", `(${rejectedIds.join(",")})`);
  }

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

  const from = (page - 1) * PAGE_SIZE;
  query = query.range(from, from + PAGE_SIZE - 1);

  const { data, error, count } = await query;
  const jobs = (data ?? []) as unknown as JobRow[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstShown = jobs.length === 0 ? 0 : from + 1;
  const lastShown = jobs.length === 0 ? 0 : from + jobs.length;

  // Preserve the active filters when moving between pages.
  const pageParams = new URLSearchParams();
  if (isSubmitted) {
    pageParams.set("filtered", "1");
    pageParams.set("hide_dismissed", hideDismissed ? "1" : "0");
  }
  if (minRaw) pageParams.set("min", minRaw);
  if (company) pageParams.set("company", company);
  if (source) pageParams.set("source", source);
  if (values.location) pageParams.set("location", values.location);
  if (values.q) pageParams.set("q", values.q);
  if (sort !== "match") pageParams.set("sort", sort);
  if (includeBelow50) pageParams.set("below50", "1");
  const hrefForPage = (p: number) => {
    const params = new URLSearchParams(pageParams);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/jobs?${qs}` : "/jobs";
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 font-sans">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Discovered across public job boards and scored on how well your
          resumes align with each description.
        </p>
      </header>

      <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <RunScan initialScan={latestScan} />
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

      <section className="mt-8 space-y-3">
        {total === 0 ? (
          filtersActive || !includeBelow50 ? (
            <p className="rounded-md border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
              No jobs at this match level. Upload a{" "}
              <a href="/resumes" className="text-blue-600 hover:underline dark:text-blue-400">
                resume
              </a>
              , run a scan, or{" "}
              <a href="/jobs?below50=1" className="text-blue-600 hover:underline dark:text-blue-400">
                show matches below 50%
              </a>
              .
            </p>
          ) : (
            <p className="rounded-md border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
              No jobs yet. Upload a{" "}
              <a href="/resumes" className="text-blue-600 hover:underline dark:text-blue-400">
                resume
              </a>{" "}
              and click <span className="font-medium">Run Job Scan</span>.
            </p>
          )
        ) : (
          <>
            <p className="text-xs text-zinc-500">
              Showing {firstShown.toLocaleString()}–{lastShown.toLocaleString()}{" "}
              of {total.toLocaleString()} job{total === 1 ? "" : "s"}
              {!includeBelow50 ? " · matches ≥ 50%" : ""}
            </p>

            {BUCKETS.map((bucket) => {
              const bucketJobs = jobs.filter(
                (j) => bucketFor(j.match_score) === bucket.key,
              );
              if (bucketJobs.length === 0) return null;
              return (
                <section key={bucket.key} className="space-y-3">
                  <h2
                    className={`mt-5 flex items-baseline gap-2 text-sm font-semibold ${bucket.headerClass}`}
                  >
                    {bucket.label}
                    <span className="text-xs font-normal text-zinc-400">
                      {bucket.sub} · {bucketJobs.length}
                    </span>
                  </h2>
                  {bucketJobs.map((j) => (
                    <JobCard key={j.id} job={j} />
                  ))}
                </section>
              );
            })}

            {totalPages > 1 ? (
              <nav
                aria-label="Pagination"
                className="flex items-center justify-between gap-3 pt-2"
              >
                {page > 1 ? (
                  <a
                    href={hrefForPage(page - 1)}
                    rel="prev"
                    className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-300 px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  >
                    ← Previous
                  </a>
                ) : (
                  <span className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 px-3 text-sm font-medium text-zinc-300 dark:border-zinc-800 dark:text-zinc-700">
                    ← Previous
                  </span>
                )}

                <span className="text-xs text-zinc-500">
                  Page {page.toLocaleString()} of {totalPages.toLocaleString()}
                </span>

                {page < totalPages ? (
                  <a
                    href={hrefForPage(page + 1)}
                    rel="next"
                    className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-300 px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  >
                    Next →
                  </a>
                ) : (
                  <span className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 px-3 text-sm font-medium text-zinc-300 dark:border-zinc-800 dark:text-zinc-700">
                    Next →
                  </span>
                )}
              </nav>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
