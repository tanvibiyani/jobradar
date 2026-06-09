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
 * `app/(app)/resumes/actions.ts` — `auth.getUser()` validates the JWT but does
 * not cache the session, and in some Server Action contexts the later
 * `getSession()` read returns null, making PostgREST fall back to the anon key
 * (`auth.uid()` NULL) and fail every owner-only `with check`. `setSession()`
 * flows through `_saveSession`, which populates that cache.
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

/**
 * Split a free-text field (commas and/or newlines) into a clean, de-duplicated
 * list. Empty entries are dropped; original casing is preserved.
 */
function parseList(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value.split(/[\n,]+/)) {
    const item = raw.trim();
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function parseMinSalary(value: string): number | null | { error: string } {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(/[,_\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) {
    return { error: "Minimum salary must be a non-negative number." };
  }
  return Math.round(n);
}

/** Years of experience: a whole number 0–60, or null when left blank. */
function parseYearsOfExperience(
  value: string,
): number | null | { error: string } {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(/[,_\s]/g, ""));
  if (!Number.isInteger(n) || n < 0 || n > 60) {
    return {
      error: "Years of experience must be a whole number between 0 and 60.",
    };
  }
  return n;
}

export async function savePreferences(
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  const roles = parseList(String(formData.get("roles") ?? ""));
  const locations = parseList(String(formData.get("locations") ?? ""));
  const keywords = parseList(String(formData.get("keywords") ?? ""));
  const remote = formData.get("remote") != null;

  const salary = parseMinSalary(String(formData.get("min_salary") ?? ""));
  if (salary !== null && typeof salary === "object") {
    return { error: salary.error };
  }

  const years = parseYearsOfExperience(
    String(formData.get("years_of_experience") ?? ""),
  );
  if (years !== null && typeof years === "object") {
    return { error: years.error };
  }

  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return { error: "You must be signed in to save preferences." };
  }

  const pinned = await pinSession(supabase);
  if (!pinned.ok) return { error: pinned.error };

  const { error: upsertError } = await supabase.from("preferences").upsert(
    {
      user_id: user.id,
      roles,
      locations,
      keywords,
      min_salary: salary,
      remote,
      years_of_experience: years,
    },
    { onConflict: "user_id" },
  );

  if (upsertError) {
    return { error: `Save failed: ${upsertError.message}` };
  }

  revalidatePath("/preferences");
  return { ok: true, message: "Preferences saved." };
}
