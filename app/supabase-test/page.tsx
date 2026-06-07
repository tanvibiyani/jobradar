import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type EnvStatus = {
  name: string;
  set: boolean;
  hint: string;
};

function checkEnv(): EnvStatus[] {
  return [
    {
      name: "NEXT_PUBLIC_SUPABASE_URL",
      set: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      hint: "Project URL — embedded in the client bundle.",
    },
    {
      name: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      set: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      hint: "Public anon key — required by both clients.",
    },
    {
      name: "SUPABASE_SERVICE_ROLE_KEY",
      set: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      hint: "Server-only. Never expose to the browser.",
    },
  ];
}

async function probeServerClient(): Promise<
  { ok: true; hasSession: boolean } | { ok: false; error: string }
> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getSession();
    if (error) return { ok: false, error: error.message };
    return { ok: true, hasSession: data.session !== null };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export default async function SupabaseTestPage() {
  const env = checkEnv();
  const probe = await probeServerClient();
  const allRequiredSet = env
    .filter((e) => e.name !== "SUPABASE_SERVICE_ROLE_KEY")
    .every((e) => e.set);

  return (
    <main className="mx-auto max-w-2xl px-6 py-16 font-sans">
      <h1 className="text-2xl font-semibold tracking-tight">
        Supabase integration check
      </h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        This page runs on the server and never prints secret values.
      </p>

      <section className="mt-8">
        <h2 className="text-lg font-medium">Environment variables</h2>
        <ul className="mt-3 space-y-2">
          {env.map((e) => (
            <li
              key={e.name}
              className="flex items-start justify-between gap-4 rounded-md border border-zinc-200 px-4 py-3 dark:border-zinc-800"
            >
              <div>
                <code className="text-sm font-medium">{e.name}</code>
                <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                  {e.hint}
                </p>
              </div>
              <span
                className={
                  e.set
                    ? "text-sm font-semibold text-green-600"
                    : "text-sm font-semibold text-red-600"
                }
              >
                {e.set ? "set" : "missing"}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm">
          {allRequiredSet
            ? "All client-required variables are present."
            : "One or more required variables are missing — check .env.local."}
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-medium">Server client probe</h2>
        <div className="mt-3 rounded-md border border-zinc-200 px-4 py-3 dark:border-zinc-800">
          {probe.ok ? (
            <>
              <p className="text-sm font-semibold text-green-600">
                createClient() initialized.
              </p>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                supabase.auth.getSession() returned{" "}
                {probe.hasSession ? "an active session" : "no session"}.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-red-600">
                Probe failed.
              </p>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                {probe.error}
              </p>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
