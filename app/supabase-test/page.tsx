export const dynamic = "force-dynamic";

export default function SupabaseTestPage() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const missing: string[] = [];
  if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!anonKey) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  return (
    <main className="mx-auto max-w-2xl px-6 py-16 font-sans">
      <h1 className="text-2xl font-semibold tracking-tight">Supabase test</h1>

      {missing.length === 0 ? (
        <p className="mt-6 text-lg font-medium text-green-600">
          Supabase Connected
        </p>
      ) : (
        <div className="mt-6 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <p className="font-semibold">Supabase not configured</p>
          <p className="mt-2 text-sm">
            Missing required environment variable
            {missing.length > 1 ? "s" : ""}:
          </p>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {missing.map((name) => (
              <li key={name}>
                <code>{name}</code>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm">
            Add the missing value{missing.length > 1 ? "s" : ""} to{" "}
            <code>.env.local</code> and restart the dev server.
          </p>
        </div>
      )}
    </main>
  );
}
