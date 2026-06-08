"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const BUCKET = "resumes";
const MAX_BYTES = 8 * 1024 * 1024; // 8MB
const ALLOWED_MIME = new Set(["application/pdf", "application/x-pdf"]);

export type UploadState =
  | { ok: true; message: string }
  | { error: string }
  | null;

function sanitizeSegment(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return result.text ?? "";
  } finally {
    await parser.destroy();
  }
}

/**
 * Pin the session into the supabase-js client's in-memory state.
 *
 * `auth.getUser()` validates the JWT against /auth/v1/user but does *not*
 * cache the session on the client — auth-js's `__loadSession` returns a
 * local `currentSession` variable and never assigns `this.currentSession`.
 * PostgREST bearer selection (`_getAccessToken`) reads the session via
 * `auth.getSession()` on every request, falling back to the anon key when
 * the storage read comes back empty. In some Next.js Server Action contexts
 * that read returns null even though the cookies are valid, which makes
 * PostgREST see `role=anon` and `auth.uid()=NULL` — every RLS-protected
 * insert then fails the `with check (user_id = (select auth.uid()))` clause.
 *
 * `setSession()` is the only public API that flows through `_saveSession`,
 * which both sets `this.currentSession` and writes the tokens into
 * `@supabase/ssr`'s in-memory `setItems` cache. After that runs, every
 * subsequent `storage.getItem` short-circuits to that cache before reading
 * cookies, so `.from()` / storage operations on the same client are
 * guaranteed to carry the user's access token.
 */
async function pinSession(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  if (!session?.access_token || !session?.refresh_token) {
    return {
      ok: false,
      error:
        "Session is not available to the server. Please sign in again.",
    };
  }
  await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  return { ok: true };
}

export async function uploadResume(
  _prev: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const title = String(formData.get("title") ?? "").trim();
  const file = formData.get("file");

  if (!title) return { error: "Title is required." };
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a PDF file to upload." };
  }
  if (!ALLOWED_MIME.has(file.type) && !file.name.toLowerCase().endsWith(".pdf")) {
    return { error: "Only PDF files are supported." };
  }
  if (file.size > MAX_BYTES) {
    return { error: `File is too large (max ${MAX_BYTES / 1024 / 1024}MB).` };
  }

  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return { error: "You must be signed in to upload a resume." };
  }

  const pinned = await pinSession(supabase);
  if (!pinned.ok) return { error: pinned.error };

  const buffer = Buffer.from(await file.arrayBuffer());

  let content = "";
  try {
    content = await extractPdfText(buffer);
  } catch (err) {
    return {
      error:
        err instanceof Error
          ? `Could not read PDF: ${err.message}`
          : "Could not read PDF.",
    };
  }

  const baseName = sanitizeSegment(file.name.replace(/\.pdf$/i, "")) || "resume";
  const filePath = `${user.id}/${randomUUID()}-${baseName}.pdf`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(filePath, buffer, {
      contentType: "application/pdf",
      upsert: false,
    });

  if (uploadError) {
    return { error: `Upload failed: ${uploadError.message}` };
  }

  const { error: insertError } = await supabase.from("resumes").insert({
    user_id: user.id,
    title,
    file_path: filePath,
    content,
  });

  if (insertError) {
    await supabase.storage.from(BUCKET).remove([filePath]);
    return { error: `Save failed: ${insertError.message}` };
  }

  revalidatePath("/resumes");
  return { ok: true, message: `Uploaded "${title}".` };
}

export async function deleteResume(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const pinned = await pinSession(supabase);
  if (!pinned.ok) return;

  const { data: row, error: fetchError } = await supabase
    .from("resumes")
    .select("file_path")
    .eq("id", id)
    .single();

  if (fetchError || !row) {
    revalidatePath("/resumes");
    return;
  }

  if (row.file_path) {
    await supabase.storage.from(BUCKET).remove([row.file_path]);
  }
  await supabase.from("resumes").delete().eq("id", id);

  revalidatePath("/resumes");
}
