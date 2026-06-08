"use server";

import * as cheerio from "cheerio";
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

// ---------------------------------------------------------------------------
// Job scraping
//
// Best-effort: we download the careers page HTML and pull out anchor tags that
// look like individual job postings. This works for server-rendered careers
// pages (incl. most hosted ATS boards). Pages that build their list with
// client-side JavaScript return little usable HTML and will surface 0 jobs.
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 12_000;
const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_JOBS_PER_FETCH = 200;

// Hrefs/paths that hint at an individual posting (ATS hosts + common paths).
const JOB_HINT =
  /(\/jobs?\/|\/careers?\/|\/positions?\/|\/openings?\/|\/opportunit|\/roles?\/|\/vacanc|[?&](gh_jid|jid|jobid|gh_src)=|greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|jobvite\.com|myworkdayjobs\.com|bamboohr\.com|recruitee\.com|teamtailor\.com|workday)/i;

// Anchor text too generic to be a real job title.
const GENERIC_TEXT = new Set([
  "apply",
  "apply now",
  "view",
  "view all",
  "view job",
  "view jobs",
  "learn more",
  "see all",
  "see more",
  "read more",
  "careers",
  "open positions",
  "all jobs",
  "open roles",
  "join us",
  "back",
  "next",
  "home",
]);

/** Reject loopback / link-local / private hosts to blunt basic SSRF. */
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h === "::1") return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true; // link-local
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true; // 172.16/12
  if (h === "0.0.0.0" || h === "[::]") return true;
  return false;
}

/** Normalize a URL for dedup: drop the fragment and any trailing slash. */
function normalizeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

async function fetchHtml(
  target: string,
): Promise<{ ok: true; html: string } | { ok: false; error: string }> {
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return { ok: false, error: "The careers URL is not a valid URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Careers URL must start with http:// or https://." };
  }
  if (isBlockedHost(parsed.hostname)) {
    return { ok: false, error: "That careers URL points to a blocked host." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; JobRadar/1.0; +https://github.com/tanvibiyani/jobradar)",
        accept: "text/html,application/xhtml+xml",
      },
    });
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error && err.name === "AbortError"
          ? "The careers page took too long to respond."
          : "Could not reach the careers page.",
    };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    return { ok: false, error: `Careers page returned HTTP ${res.status}.` };
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (!/text\/html|application\/xhtml/i.test(contentType)) {
    return { ok: false, error: "Careers URL did not return an HTML page." };
  }

  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_HTML_BYTES) {
    return { ok: false, error: "The careers page is too large to process." };
  }
  return { ok: true, html: new TextDecoder().decode(buf) };
}

type ScrapedJob = { title: string; url: string };

/** Pull plausible job postings (title + absolute URL) out of careers HTML. */
function extractJobs(html: string, baseUrl: string): ScrapedJob[] {
  const $ = cheerio.load(html);
  const byUrl = new Map<string, ScrapedJob>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href")?.trim();
    if (!href) return;
    if (/^(#|javascript:|mailto:|tel:)/i.test(href)) return;

    let absolute: string;
    try {
      absolute = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    if (!JOB_HINT.test(absolute)) return;

    const title = $(el).text().replace(/\s+/g, " ").trim();
    if (title.length < 3 || title.length > 120) return;
    if (GENERIC_TEXT.has(title.toLowerCase())) return;

    const key = normalizeUrl(absolute);
    if (!key) return;
    if (!byUrl.has(key)) byUrl.set(key, { title, url: key });
  });

  return Array.from(byUrl.values()).slice(0, MAX_JOBS_PER_FETCH);
}

export async function fetchJobs(
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  const companyId = String(formData.get("id") ?? "").trim();
  if (!companyId) return { error: "Missing company id." };

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return { error: "You must be signed in to fetch jobs." };
  }

  const pinned = await pinSession(supabase);
  if (!pinned.ok) return { error: pinned.error };

  // RLS already scopes this to the owner; the user_id match is defense in depth.
  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id,name,careers_url")
    .eq("id", companyId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (companyError) return { error: `Lookup failed: ${companyError.message}` };
  if (!company) return { error: "Company not found." };
  if (!company.careers_url) {
    return { error: "Add a career page URL for this company first." };
  }

  const fetched = await fetchHtml(company.careers_url);
  if (!fetched.ok) return { error: fetched.error };

  const scraped = extractJobs(fetched.html, company.careers_url);
  if (scraped.length === 0) {
    return {
      ok: true,
      message:
        "No job links found. The careers page may render its listings with JavaScript.",
    };
  }

  const source = (() => {
    try {
      return new URL(company.careers_url).hostname;
    } catch {
      return null;
    }
  })();

  const rows = scraped.map((j) => ({
    user_id: user.id,
    company_id: company.id,
    title: j.title,
    url: j.url,
    source,
  }));

  // Dedup by URL: the unique index on (user_id, url) backs ON CONFLICT DO
  // NOTHING, so `.select()` returns only the rows that were actually inserted.
  const { data: inserted, error: insertError } = await supabase
    .from("jobs")
    .upsert(rows, { onConflict: "user_id,url", ignoreDuplicates: true })
    .select("id");

  if (insertError) return { error: `Save failed: ${insertError.message}` };

  const added = inserted?.length ?? 0;
  const skipped = scraped.length - added;

  revalidatePath("/jobs");
  revalidatePath("/companies");

  return {
    ok: true,
    message:
      `Found ${scraped.length} posting${scraped.length === 1 ? "" : "s"} · ` +
      `${added} new` +
      (skipped > 0 ? `, ${skipped} already saved` : ""),
  };
}
