// Instant Suspense fallback for every route in the (app) group. Because the
// shared layout (nav) is preserved across client-side navigations, clicking a
// tab swaps in this skeleton immediately while the page's server component
// streams in — so navigation always feels responsive even on a slow query.
export default function Loading() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-12 font-sans" aria-busy="true">
      <div className="animate-pulse space-y-8">
        <div className="space-y-3">
          <div className="h-7 w-48 rounded-md bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-4 w-80 max-w-full rounded bg-zinc-100 dark:bg-zinc-900" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-20 rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50"
            />
          ))}
        </div>

        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-24 rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50"
            />
          ))}
        </div>
      </div>

      <span className="sr-only">Loading…</span>
    </main>
  );
}
