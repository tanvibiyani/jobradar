// Shared types for automated job discovery across public ATS feeds.

/** The three public ATS APIs we know how to read. */
export type AtsType = "greenhouse" | "lever" | "ashby";

/**
 * A company we know how to discover jobs for, seeded in the registry
 * (lib/ats/sources.ts). `ats_slug` is the board identifier in that ATS's
 * public API (the greenhouse board name, the lever account, or the ashby
 * job-board name). `enabled` gates whether a scan fetches from it.
 */
export type AtsSource = {
  company_name: string;
  ats_type: AtsType;
  ats_slug: string;
  enabled: boolean;
};

/**
 * A job posting after we've normalized it out of a provider-specific payload.
 * This is the shape the scanner filters, scores, and stores. `user_id` and
 * `discovered_at` are added at storage time (the latter via a DB default), so
 * they aren't part of the fetched shape.
 */
export type DiscoveredJob = {
  company_name: string;
  title: string;
  url: string;
  location: string | null;
  description: string | null;
  source: string; // human-readable provider label, e.g. "Greenhouse"
  /** Best-effort remote flag derived from the feed; used for filtering/scoring. */
  remote: boolean;
  /** When the posting went live, when the feed exposes it. */
  posted_at: string | null;
};

/** A user's saved search preferences, already normalized to arrays. */
export type Preferences = {
  roles: string[];
  locations: string[];
  keywords: string[];
  min_salary: number | null;
  remote: boolean;
  /** Candidate years of experience; null when the user hasn't set it. */
  years_of_experience: number | null;
};

