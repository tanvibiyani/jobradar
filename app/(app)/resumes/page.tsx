import { createClient } from "@/lib/supabase/server";
import { UploadForm } from "./upload-form";
import { DeleteForm } from "./delete-form";

export const dynamic = "force-dynamic";

type ResumeRow = {
  id: string;
  title: string;
  file_path: string | null;
  content: string | null;
  created_at: string;
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

export default async function ResumesPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("resumes")
    .select("id,title,file_path,content,created_at")
    .order("created_at", { ascending: false });

  const resumes = (data ?? []) as ResumeRow[];

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 font-sans">
      <header className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Resumes</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Upload PDF resumes. Extracted text is stored alongside the file so
            we can score matches against it.
          </p>
        </div>
      </header>

      <section className="mt-8">
        <UploadForm />
      </section>

      {error ? (
        <p
          role="alert"
          className="mt-6 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          Could not load resumes: {error.message}
        </p>
      ) : null}

      <section className="mt-10">
        <h2 className="text-lg font-medium">Your resumes</h2>

        {resumes.length === 0 ? (
          <p className="mt-4 rounded-md border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
            No resumes yet. Upload your first one above.
          </p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="px-4 py-3 font-medium">Uploaded</th>
                  <th className="px-4 py-3 font-medium">Extracted</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {resumes.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-3 font-medium">{r.title}</td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {formatDate(r.created_at)}
                    </td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {r.content
                        ? `${r.content.length.toLocaleString()} chars`
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <DeleteForm id={r.id} title={r.title} />
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
