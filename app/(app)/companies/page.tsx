import { createClient } from "@/lib/supabase/server";
import { AddCompanyForm } from "./add-form";
import { CompanyRow, type Company } from "./company-row";

export const dynamic = "force-dynamic";

export default async function CompaniesPage() {
  const supabase = await createClient();

  // RLS ("companies select own") restricts this to the signed-in user's rows.
  const { data, error } = await supabase
    .from("companies")
    .select("id,name,website,careers_url,notes")
    .order("name", { ascending: true });

  const companies = (data ?? []) as Company[];

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 font-sans">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Companies</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Track companies you&apos;re interested in, along with their careers
          pages and your own notes.
        </p>
      </header>

      <section className="mt-8">
        <AddCompanyForm />
      </section>

      {error ? (
        <p
          role="alert"
          className="mt-6 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          Could not load companies: {error.message}
        </p>
      ) : null}

      <section className="mt-10">
        <h2 className="text-lg font-medium">Your companies</h2>

        {companies.length === 0 ? (
          <p className="mt-4 rounded-md border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
            No companies yet. Add your first one above.
          </p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Website</th>
                  <th className="px-4 py-3 font-medium">Careers</th>
                  <th className="px-4 py-3 font-medium">Notes</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {companies.map((c) => (
                  <CompanyRow key={c.id} company={c} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
