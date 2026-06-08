import type { AtsSource } from "./types";

// ---------------------------------------------------------------------------
// Seed list of known ATS companies.
//
// JobRadar's MVP discovers jobs from this fixed set of public ATS boards — the
// user no longer has to add companies by hand before they can find jobs. Each
// entry's `token` is verified to resolve against that provider's public,
// unauthenticated API (see lib/ats/fetchers.ts).
//
// Notes on a couple of the requested companies:
//   - Several of them don't run on the ATS the brief guessed. They're mapped
//     here to the provider whose public feed actually returns their postings
//     (e.g. Asana/Datadog/Brex/Anthropic on Greenhouse, Ramp/Notion/Plaid/
//     Perplexity on Ashby, Glean on Greenhouse under the "gleanwork" board).
//   - Rippling does not expose a public Greenhouse/Lever/Ashby board, so it is
//     intentionally omitted rather than left as a dead endpoint that 404s on
//     every scan.
//   - Spotify (Lever) is included so discovery exercises all three providers.
// ---------------------------------------------------------------------------
export const SEED_SOURCES: AtsSource[] = [
  // Greenhouse
  { company: "Asana", provider: "greenhouse", token: "asana" },
  { company: "Datadog", provider: "greenhouse", token: "datadog" },
  { company: "Brex", provider: "greenhouse", token: "brex" },
  { company: "Anthropic", provider: "greenhouse", token: "anthropic" },
  { company: "Glean", provider: "greenhouse", token: "gleanwork" },

  // Ashby
  { company: "Ramp", provider: "ashby", token: "ramp" },
  { company: "Notion", provider: "ashby", token: "notion" },
  { company: "Plaid", provider: "ashby", token: "plaid" },
  { company: "Perplexity", provider: "ashby", token: "perplexity" },

  // Lever
  { company: "Spotify", provider: "lever", token: "spotify" },
];
