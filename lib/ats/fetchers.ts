import type { AtsSource, DiscoveredJob } from "./types";

// ---------------------------------------------------------------------------
// Public ATS fetchers.
//
// Each fetcher hits a provider's public, unauthenticated job-board API and
// normalizes the response into DiscoveredJob[]. No logins, no captcha solving,
// no paid APIs, no LinkedIn — just the JSON feeds these ATSes publish for their
// hosted career pages.
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 15_000;
const MAX_BYTES = 12 * 1024 * 1024; // generous; the largest boards run ~2–3MB
const MAX_DESCRIPTION_CHARS = 4_000; // cap stored text; full text is used in-memory for scoring
// Scan limit: cap how many postings a single source contributes so one giant
// board (some return 700–2000 jobs) can't dominate a scan's memory or storage.
const MAX_JOBS_PER_SOURCE = 250;
const UA =
  "Mozilla/5.0 (compatible; JobRadar/1.0; +https://github.com/tanvibiyani/jobradar)";

async function getJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": UA, accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      throw new Error("response too large");
    }
    return JSON.parse(new TextDecoder().decode(buf));
  } finally {
    clearTimeout(timer);
  }
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/** Turn (possibly entity-encoded) HTML into trimmed, capped plain text. */
function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = html
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > MAX_DESCRIPTION_CHARS
    ? text.slice(0, MAX_DESCRIPTION_CHARS)
    : text;
}

function cap(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > MAX_DESCRIPTION_CHARS ? t.slice(0, MAX_DESCRIPTION_CHARS) : t;
}

/** Loose remote detection from a free-text location string. */
function looksRemote(location: string | null | undefined): boolean {
  return location ? /\bremote\b|\banywhere\b|work from home/i.test(location) : false;
}

// --- Greenhouse ------------------------------------------------------------
// https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true

type GhJob = {
  title?: string;
  absolute_url?: string;
  location?: { name?: string } | null;
  content?: string | null;
  updated_at?: string | null;
  first_published?: string | null;
};

async function fetchGreenhouse(src: AtsSource): Promise<DiscoveredJob[]> {
  const data = (await getJson(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(
      src.ats_slug,
    )}/jobs?content=true`,
  )) as { jobs?: GhJob[] };

  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  const out: DiscoveredJob[] = [];
  for (const j of jobs) {
    if (!j.title || !j.absolute_url) continue;
    const location = j.location?.name?.trim() || null;
    out.push({
      company_name: src.company_name,
      title: j.title.trim(),
      url: j.absolute_url,
      location,
      description: htmlToText(j.content),
      source: "Greenhouse",
      remote: looksRemote(location),
      posted_at: j.first_published ?? j.updated_at ?? null,
    });
  }
  return out;
}

// --- Lever -----------------------------------------------------------------
// https://api.lever.co/v0/postings/{token}?mode=json

type LeverJob = {
  text?: string;
  hostedUrl?: string;
  applyUrl?: string;
  descriptionPlain?: string;
  workplaceType?: string; // "remote" | "hybrid" | "on-site"
  createdAt?: number; // ms epoch
  categories?: { location?: string; allLocations?: string[] } | null;
};

async function fetchLever(src: AtsSource): Promise<DiscoveredJob[]> {
  const data = (await getJson(
    `https://api.lever.co/v0/postings/${encodeURIComponent(src.ats_slug)}?mode=json`,
  )) as LeverJob[];

  const jobs = Array.isArray(data) ? data : [];
  const out: DiscoveredJob[] = [];
  for (const j of jobs) {
    const url = j.hostedUrl || j.applyUrl;
    if (!j.text || !url) continue;
    const location =
      j.categories?.location?.trim() ||
      j.categories?.allLocations?.[0]?.trim() ||
      null;
    out.push({
      company_name: src.company_name,
      title: j.text.trim(),
      url,
      location,
      description: cap(j.descriptionPlain),
      source: "Lever",
      remote: j.workplaceType?.toLowerCase() === "remote" || looksRemote(location),
      posted_at:
        typeof j.createdAt === "number"
          ? new Date(j.createdAt).toISOString()
          : null,
    });
  }
  return out;
}

// --- Ashby -----------------------------------------------------------------
// https://api.ashbyhq.com/posting-api/job-board/{token}

type AshbyJob = {
  title?: string;
  jobUrl?: string;
  applyUrl?: string;
  location?: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
  isRemote?: boolean | null;
  workplaceType?: string; // "Remote" | "Hybrid" | "Onsite"
  publishedAt?: string | null;
  isListed?: boolean;
};

async function fetchAshby(src: AtsSource): Promise<DiscoveredJob[]> {
  const data = (await getJson(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(
      src.ats_slug,
    )}`,
  )) as { jobs?: AshbyJob[] };

  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  const out: DiscoveredJob[] = [];
  for (const j of jobs) {
    const url = j.jobUrl || j.applyUrl;
    if (!j.title || !url) continue;
    if (j.isListed === false) continue; // unlisted postings aren't public
    const location = j.location?.trim() || null;
    out.push({
      company_name: src.company_name,
      title: j.title.trim(),
      url,
      location,
      description: cap(j.descriptionPlain) ?? htmlToText(j.descriptionHtml),
      source: "Ashby",
      remote:
        j.isRemote === true ||
        j.workplaceType?.toLowerCase() === "remote" ||
        looksRemote(location),
      posted_at: j.publishedAt ?? null,
    });
  }
  return out;
}

/** Fetch and normalize one source's postings. Throws on network/parse errors. */
export async function fetchSource(src: AtsSource): Promise<DiscoveredJob[]> {
  let jobs: DiscoveredJob[];
  switch (src.ats_type) {
    case "greenhouse":
      jobs = await fetchGreenhouse(src);
      break;
    case "lever":
      jobs = await fetchLever(src);
      break;
    case "ashby":
      jobs = await fetchAshby(src);
      break;
  }
  return jobs.length > MAX_JOBS_PER_SOURCE
    ? jobs.slice(0, MAX_JOBS_PER_SOURCE)
    : jobs;
}
