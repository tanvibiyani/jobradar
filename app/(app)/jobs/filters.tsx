// A plain GET form: submitting navigates to /jobs?… so filter state lives in
// the URL (shareable, bookmarkable) and the server component re-queries. No
// client JS required. The hidden `filtered=1` marker lets the page tell a
// fresh visit (defaults applied) from an explicit submit where an unchecked
// "hide dismissed" box should be honored.

export type JobFilterValues = {
  min: string;
  company: string;
  source: string;
  location: string;
  q: string;
  sort: string;
  hideDismissed: boolean;
  includeBelow50: boolean;
};

const fieldClass =
  "mt-1 block h-9 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const labelClass = "block text-xs font-medium text-zinc-600 dark:text-zinc-400";

export function JobFilters({
  values,
  companies,
  sources,
  active,
}: {
  values: JobFilterValues;
  companies: string[];
  sources: string[];
  active: boolean;
}) {
  return (
    <form
      method="get"
      action="/jobs"
      className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
    >
      <input type="hidden" name="filtered" value="1" />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className={labelClass}>
          Title keyword
          <input
            type="text"
            name="q"
            defaultValue={values.q}
            maxLength={100}
            placeholder="e.g. engineer"
            className={fieldClass}
          />
        </label>

        <label className={labelClass}>
          Company
          <select name="company" defaultValue={values.company} className={fieldClass}>
            <option value="">Any company</option>
            {companies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className={labelClass}>
          Source
          <select name="source" defaultValue={values.source} className={fieldClass}>
            <option value="">Any source</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className={labelClass}>
          Location
          <input
            type="text"
            name="location"
            defaultValue={values.location}
            maxLength={100}
            placeholder="e.g. New York, Remote"
            className={fieldClass}
          />
        </label>

        <label className={labelClass}>
          Minimum match score
          <input
            type="number"
            name="min"
            min={0}
            max={100}
            step={5}
            inputMode="numeric"
            defaultValue={values.min}
            placeholder="0"
            className={fieldClass}
          />
        </label>

        <label className={labelClass}>
          Sort by
          <select name="sort" defaultValue={values.sort} className={fieldClass}>
            <option value="match">Best match</option>
            <option value="newest">Newest discovered</option>
          </select>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4">
        <label className="inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            name="below50"
            value="1"
            defaultChecked={values.includeBelow50}
            className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700"
          />
          Show matches below 50%
        </label>

        <label className="inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            name="hide_dismissed"
            value="1"
            defaultChecked={values.hideDismissed}
            className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700"
          />
          Hide dismissed jobs
        </label>

        <div className="ml-auto flex items-center gap-2">
          {active ? (
            <a
              href="/jobs"
              className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-300 px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Clear
            </a>
          ) : null}
          <button
            type="submit"
            className="inline-flex h-9 items-center justify-center rounded-md bg-black px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            Apply filters
          </button>
        </div>
      </div>
    </form>
  );
}
