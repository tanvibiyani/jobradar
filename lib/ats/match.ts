import {
  STOPWORDS,
  GENERIC_WORDS,
  DOMAIN_TERMS,
  KNOWN_PHRASES,
} from "./lexicon";

// ---------------------------------------------------------------------------
// Deterministic, offline resume↔job-description matcher.
//
// The match score is driven ONLY by how well a resume's wording overlaps the
// job description's *meaningful* terms — exact word and (more heavily) exact
// phrase matches of tools, systems, skills, methodologies, metrics, and
// business terms. Generic filler is excluded; location/company/preferences play
// no part. No APIs, no models — just string and set operations.
// ---------------------------------------------------------------------------

export type WeightedTerm = { term: string; weight: number };

export type JobTerms = {
  keywords: WeightedTerm[];
  phrases: WeightedTerm[];
};

export type ResumeDoc = {
  id: string;
  title: string;
  content: string;
};

export type ResumeScore = {
  score: number;
  matchedKeywords: string[];
  matchedPhrases: string[];
  missingKeywords: string[];
  missingPhrases: string[];
};

export type BestMatch = {
  score: number | null;
  bestResumeId: string | null;
  bestResumeTitle: string | null;
  matchedKeywords: string[];
  matchedPhrases: string[];
  missingKeywords: string[];
  resumeTweaks: string[];
};

// --- Tuning knobs ----------------------------------------------------------
const KEYWORD_WEIGHT = { domain: 3, acronym: 3, symbol: 2, content: 1 };
const PHRASE_WEIGHT = { known: 6, trigram: 5, bigram: 4, domainBonus: 1 };
const MAX_KEYWORDS = 50;
const MAX_PHRASES = 30;
const MAX_RESUME_SCAN_CHARS = 20_000;

// Scoring model: a job's score is keyword recall over its CORE terms (the
// backbone) plus an additive bonus for each exact phrase match (phrases are
// rewarded more than words, but unmatched phrases don't tank the score).
//   score = 100 * min(1, kwCoverage * KW_GAIN + phraseBonus)
// Calibrated so a genuinely on-target resume reaches ~80–95, a perfect 100
// stays rare, and an unrelated resume sits low.
const SCORE_KEYWORDS = 30; // core keyword target the score is measured against
const SCORE_PHRASES = 16; // core phrase target
const KW_GAIN = 2.4;
const PHRASE_BONUS_PER_WEIGHT = 0.02; // a known phrase (w≈6) adds ≈0.12
const PHRASE_BONUS_CAP = 0.2;

// --- Text utilities --------------------------------------------------------

/** Lowercase, turn hyphens/slashes/underscores into spaces, collapse space. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\/_]+/g, " ")
    .replace(/-+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const TOKEN_RE = /[a-z0-9][a-z0-9+#.&]*/g;

/** Ordered tokens from already-normalized text, keeping c++/c#/node.js/p&l. */
function tokenize(normalized: string): string[] {
  const out: string[] = [];
  const matches = normalized.match(TOKEN_RE) ?? [];
  for (let t of matches) {
    t = t.replace(/^[.&]+|[.&]+$/g, "");
    if (t.length >= 2) out.push(t);
  }
  return out;
}

// Pure numbers and number-led tokens ("200b", "401k", "000+") are noise.
const isJunk = (t: string) => /^[0-9]/.test(t);

/** A space-padded, single-spaced haystack for whole-phrase substring search. */
function haystackOf(normalized: string): string {
  return ` ${normalized} `;
}
function containsPhrase(haystack: string, phrase: string): boolean {
  return haystack.includes(` ${phrase} `);
}

// --- Job-description term extraction ---------------------------------------

/** Collect acronyms (QBR, ETL, S3, KPI…) from the ORIGINAL-case text. */
function acronymSet(originalText: string): Set<string> {
  const set = new Set<string>();
  const matches = originalText.match(/\b[A-Z][A-Za-z0-9]*[A-Z0-9]\b/g) ?? [];
  for (const m of matches) {
    // All-caps (optionally with digits): QBR, ETL, SQL, KPI, S3, OAUTH.
    if (/^[A-Z0-9]{2,6}$/.test(m)) set.add(m.toLowerCase());
  }
  return set;
}

function keywordWeight(
  token: string,
  acronyms: Set<string>,
): number {
  if (DOMAIN_TERMS.has(token)) return KEYWORD_WEIGHT.domain;
  if (acronyms.has(token)) return KEYWORD_WEIGHT.acronym;
  if (/[+#.&0-9]/.test(token)) return KEYWORD_WEIGHT.symbol; // c++, oauth2, p&l
  return KEYWORD_WEIGHT.content;
}

const freqBoost = (freq: number) => 1 + Math.min(freq - 1, 2) * 0.25;

/**
 * Extract the weighted keyword and phrase targets from a job's title +
 * description. The title is folded in twice so its terms carry more weight.
 * The company name is excluded so a job never matches on its own brand.
 */
export function extractJobTerms(
  title: string,
  companyName: string,
  description: string,
): JobTerms {
  const original = `${title} ${title} ${description}`;
  const normalized = normalize(original);
  const tokens = tokenize(normalized);
  const acronyms = acronymSet(original);
  const excluded = new Set(tokenize(normalize(companyName)));

  // URL/domain tokens (engineering.ramp.com) are noise; known tech terms that
  // happen to contain dots (node.js, .net) are whitelisted via the gazetteer.
  const isDomainToken = (t: string) =>
    t.includes(".") && !DOMAIN_TERMS.has(t) && /\.[a-z]{2,4}$/.test(t);

  const isContentToken = (t: string) =>
    t.length >= 2 &&
    !isJunk(t) &&
    !isDomainToken(t) &&
    !STOPWORDS.has(t) &&
    !GENERIC_WORDS.has(t) &&
    !excluded.has(t);

  // --- Keywords (single tokens) ---
  const kwFreq = new Map<string, number>();
  for (const t of tokens) {
    if (!isContentToken(t)) continue;
    kwFreq.set(t, (kwFreq.get(t) ?? 0) + 1);
  }
  const keywords: WeightedTerm[] = [];
  for (const [term, freq] of kwFreq) {
    keywords.push({ term, weight: keywordWeight(term, acronyms) * freqBoost(freq) });
  }
  keywords.sort((a, b) => b.weight - a.weight);
  const topKeywords = keywords.slice(0, MAX_KEYWORDS);

  // --- Phrases ---
  const phraseFreq = new Map<string, number>();
  const phraseWeight = new Map<string, number>();

  // Known multi-word phrases present verbatim in the JD.
  const haystack = haystackOf(normalized);
  for (const p of KNOWN_PHRASES) {
    if (containsPhrase(haystack, p)) {
      phraseWeight.set(p, PHRASE_WEIGHT.known);
      phraseFreq.set(p, 1);
    }
  }

  // Extracted bi/tri-grams: every token must be a content token (no stopwords,
  // generic filler, numbers, or the company name anywhere in the phrase).
  for (let n = 2; n <= 3; n++) {
    for (let i = 0; i + n <= tokens.length; i++) {
      const gram = tokens.slice(i, i + n);
      if (!gram.every(isContentToken)) continue;
      const phrase = gram.join(" ");
      if (phraseWeight.has(phrase)) {
        phraseFreq.set(phrase, (phraseFreq.get(phrase) ?? 0) + 1);
        continue;
      }
      const base = n === 3 ? PHRASE_WEIGHT.trigram : PHRASE_WEIGHT.bigram;
      const bonus = gram.some((t) => DOMAIN_TERMS.has(t))
        ? PHRASE_WEIGHT.domainBonus
        : 0;
      phraseWeight.set(phrase, base + bonus);
      phraseFreq.set(phrase, (phraseFreq.get(phrase) ?? 0) + 1);
    }
  }

  const phrases: WeightedTerm[] = [];
  for (const [term, w] of phraseWeight) {
    phrases.push({ term, weight: w * freqBoost(phraseFreq.get(term) ?? 1) });
  }
  phrases.sort((a, b) => b.weight - a.weight);
  const topPhrases = phrases.slice(0, MAX_PHRASES);

  return { keywords: topKeywords, phrases: topPhrases };
}

// --- Scoring one resume against a job --------------------------------------

/** Precompute the lookups a resume needs (token set + phrase haystack). */
export function prepareResume(content: string): {
  tokens: Set<string>;
  haystack: string;
} {
  const normalized = normalize(content).slice(0, MAX_RESUME_SCAN_CHARS);
  return {
    tokens: new Set(tokenize(normalized)),
    haystack: haystackOf(normalized),
  };
}

export function scoreResume(
  job: JobTerms,
  resume: { tokens: Set<string>; haystack: string },
): ResumeScore {
  // Keyword recall over the core target set drives the base score; matches and
  // misses for display/tweaks are collected over the full extracted set.
  const coreKw = job.keywords.slice(0, SCORE_KEYWORDS);
  let coreKwTotal = 0;
  let coreKwMatched = 0;
  for (const kw of coreKw) {
    coreKwTotal += kw.weight;
    if (resume.tokens.has(kw.term)) coreKwMatched += kw.weight;
  }
  const kwCoverage = coreKwTotal > 0 ? coreKwMatched / coreKwTotal : 0;

  const matchedKeywords: string[] = [];
  const missingKeywords: WeightedTerm[] = [];
  for (const kw of job.keywords) {
    if (resume.tokens.has(kw.term)) matchedKeywords.push(kw.term);
    else if (kw.weight >= KEYWORD_WEIGHT.symbol) missingKeywords.push(kw);
  }

  // Phrase matches are an additive bonus, weighted toward the core phrases.
  const corePhrases = new Set(
    job.phrases.slice(0, SCORE_PHRASES).map((p) => p.term),
  );
  let bonusWeight = 0;
  const matchedPhrases: string[] = [];
  const missingPhrases: WeightedTerm[] = [];
  for (const ph of job.phrases) {
    if (containsPhrase(resume.haystack, ph.term)) {
      matchedPhrases.push(ph.term);
      if (corePhrases.has(ph.term)) bonusWeight += ph.weight;
    } else {
      missingPhrases.push(ph);
    }
  }
  const phraseBonus = Math.min(
    PHRASE_BONUS_CAP,
    bonusWeight * PHRASE_BONUS_PER_WEIGHT,
  );

  const score = Math.round(
    Math.min(100, 100 * (kwCoverage * KW_GAIN + phraseBonus)),
  );

  missingKeywords.sort((a, b) => b.weight - a.weight);
  missingPhrases.sort((a, b) => b.weight - a.weight);

  return {
    score,
    matchedKeywords,
    matchedPhrases,
    missingKeywords: missingKeywords.map((t) => t.term),
    missingPhrases: missingPhrases.map((t) => t.term),
  };
}

// --- Resume tweak suggestions ----------------------------------------------

/**
 * Truthful, non-fabricating suggestions: surface the JD's exact phrases/keywords
 * the chosen resume is missing, always framed as "if accurate / if you've done
 * this". We never claim the candidate has the experience.
 */
export function buildTweaks(
  missingPhrases: string[],
  missingKeywords: string[],
): string[] {
  const tweaks: string[] = [];

  const phrases = missingPhrases.slice(0, 3).map((p) => `'${p}'`);
  if (phrases.length === 1) {
    tweaks.push(`Consider adding ${phrases[0]} if it accurately reflects your experience.`);
  } else if (phrases.length > 1) {
    const list = `${phrases.slice(0, -1).join(", ")} and ${phrases[phrases.length - 1]}`;
    tweaks.push(
      `The job description emphasizes ${list} — use these exact phrases if they reflect work you've actually done.`,
    );
  }

  const keywords = missingKeywords.slice(0, 6).map((k) => `'${k}'`);
  if (keywords.length) {
    tweaks.push(
      `Your best resume doesn't surface ${keywords.join(", ")}. Add the ones you genuinely have hands-on experience with so the ATS sees an exact match.`,
    );
  }

  if (tweaks.length === 0) {
    tweaks.push(
      "Strong alignment — your resume already mirrors the job description's key terms.",
    );
  }
  return tweaks;
}

// --- Top level: best resume for a job --------------------------------------

/**
 * Score `job` against every resume, return the best resume's match plus the
 * data we persist. Returns a null score when the user has no resumes.
 */
export function matchJobToResumes(
  title: string,
  companyName: string | null,
  description: string | null,
  resumes: Array<ResumeDoc & { prepared: ReturnType<typeof prepareResume> }>,
): BestMatch {
  if (resumes.length === 0) {
    return {
      score: null,
      bestResumeId: null,
      bestResumeTitle: null,
      matchedKeywords: [],
      matchedPhrases: [],
      missingKeywords: [],
      resumeTweaks: [],
    };
  }

  const job = extractJobTerms(title, companyName ?? "", description ?? "");

  let best: { resume: ResumeDoc; result: ResumeScore } | null = null;
  for (const resume of resumes) {
    const result = scoreResume(job, resume.prepared);
    if (!best || result.score > best.result.score) {
      best = { resume, result };
    }
  }
  if (!best) {
    return {
      score: 0,
      bestResumeId: null,
      bestResumeTitle: null,
      matchedKeywords: [],
      matchedPhrases: [],
      missingKeywords: [],
      resumeTweaks: [],
    };
  }

  const { resume, result } = best;
  return {
    score: result.score,
    bestResumeId: resume.id,
    bestResumeTitle: resume.title,
    matchedKeywords: result.matchedKeywords.slice(0, 40),
    matchedPhrases: result.matchedPhrases.slice(0, 25),
    missingKeywords: result.missingKeywords.slice(0, 12),
    resumeTweaks: buildTweaks(result.missingPhrases, result.missingKeywords),
  };
}
