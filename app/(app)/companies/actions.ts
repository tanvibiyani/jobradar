"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type SaveState =
  | { ok: true; message: string }
  | { error: string }
  | null;

/**
 * Pin the session into the supabase-js client's in-memory state so RLS-bound
 * writes carry the user's access token. See the long-form rationale in
 * `app/(app)/resumes/actions.ts` — without this, PostgREST can fall back to the
 * anon key (`auth.uid()` NULL) in a Server Action and every owner-only
 * `with check` fails.
 */
async function pinSession(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  if (!session?.access_token || !session?.refresh_token) {
    return {
      ok: false,
      error: "Session is not available to the server. Please sign in again.",
    };
  }
  await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  return { ok: true };
}

/** Trim a field; return null when blank so empty strings aren't stored. */
function clean(value: FormDataEntryValue | null): string | null {
  const s = String(value ?? "").trim();
  return s.length ? s : null;
}

type Fields = {
  name: string | null;
  website: string | null;
  careers_url: string | null;
  notes: string | null;
};

function readFields(formData: FormData): Fields {
  return {
    name: clean(formData.get("name")),
    website: clean(formData.get("website")),
    careers_url: clean(formData.get("careers_url")),
    notes: clean(formData.get("notes")),
  };
}

export async function addCompany(
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  const fields = readFields(formData);
  if (!fields.name) return { error: "Company name is required." };

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return { error: "You must be signed in to add a company." };
  }

  const pinned = await pinSession(supabase);
  if (!pinned.ok) return { error: pinned.error };

  const { error } = await supabase
    .from("companies")
    .insert({ user_id: user.id, ...fields });

  if (error) return { error: `Save failed: ${error.message}` };

  revalidatePath("/companies");
  return { ok: true, message: `Added "${fields.name}".` };
}

export async function updateCompany(
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Missing company id." };

  const fields = readFields(formData);
  if (!fields.name) return { error: "Company name is required." };

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return { error: "You must be signed in to edit a company." };
  }

  const pinned = await pinSession(supabase);
  if (!pinned.ok) return { error: pinned.error };

  // RLS ("companies update own") scopes this to the owner; the explicit
  // user_id match is defense in depth.
  const { error } = await supabase
    .from("companies")
    .update(fields)
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return { error: `Save failed: ${error.message}` };

  revalidatePath("/companies");
  return { ok: true, message: "Saved." };
}

export async function deleteCompany(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const pinned = await pinSession(supabase);
  if (!pinned.ok) return;

  await supabase.from("companies").delete().eq("id", id).eq("user_id", user.id);

  revalidatePath("/companies");
}
