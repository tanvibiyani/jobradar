import {
  STOPWORDS,
  GENERIC_WORDS,
  DOMAIN_TERMS,
  KNOWN_PHRASES,
  ACTION_VERBS,
  SENIORITY_WORDS,
} from "./lexicon";

// ---------------------------------------------------------------------------
// Deterministic, offline resume↔job-description matcher (rules-based, no APIs).
//
// The score is resume-to-JD ATS alignment ONLY. Company, source, location and
// preferences play no part. A 100 is near-impossible by construction: it
// requires near-exact alignment across title, responsibilities, key skills,
// and the experience requirement. The score is the sum of five components:
//
//   Exact ATS keyword hits ............ 35
//   Exact phrase matches (responsib.) . 25
//   Core responsibility overlap ....... 20
//   Experience range alignment ........ 15
//   Seniority / title alignment .......  5
//
// then bounded by a set of caps (see CAP) so weak/partial matches can't reach
// the top regardless of keyword stuffing.
// ---------------------------------------------------------------------------

// The candidate's years of experience is configured per-user in Preferences and
// threaded into the matcher at scan time (see `matchJobToResumes`). When it's
// unset (null) experience scoring is not applied and the score is capped — see
// `scoreExperience`.

export type ResumeDoc = {
  id: string;
  title: string;
  content: string;
};

/** The persisted, display-ready detail of one resume↔job comparison. */
export type MatchDetail = {
  matchedAtsKeywords: string[];
  matchedExactPhrases: string[];
  matchedResponsibilities: string[];
  missingImportantKeywords: string[];
  missingCorePhrases: string[];
  experienceRequirement: string; // human-readable, e.g. "4–8 years" / "Not specified"
  experienceAlignmentReason: string;
  resumeTweaks: string[];
  matchReason: string; // short one-liner for the card
};

export type BestMatch = MatchDetail & {
  score: number | null; // null only when the user has no resumes
  bestResumeId: string | null;
  bestResumeTitle: string | null;
};

// --- Component point budgets (sum = 100). ----------------------------------
const PTS = {
  keywords: 35,
  phrases: 25,
  responsibilities: 20,
  experience: 15,
  title: 5,
};

// --- Score caps (a 100 is intentionally near-unreachable). -----------------
const CAP = {
  normal: 92, // ceiling unless title + phrases + experience are ALL excellent
  weakResponsibility: 75, // weak duty overlap, even with many keyword hits
  missingExperience: 85, // JD states no years requirement
  unknownCandidateExperience: 85, // user hasn't set their YOE — lower confidence
  titleMismatch: 80, // resume doesn't reflect the role at all
  noStrongPhrase: 78, // zero exact responsibility-phrase matches
};

const MAX_KEYWORDS = 50;
const SCORE_KEYWORDS = 30; // core keyword target the keyword component measures
const MAX_RESPONSIBILITIES = 16;
const SCORE_RESPONSIBILITIES = 10; // core duties the responsibility component measures
const MAX_CORE_PHRASES = 16; // responsibility phrases + known phrases used for component B
const MAX_RESUME_SCAN_CHARS = 20_000;

const KEYWORD_WEIGHT = { domain: 3, acronym: 3, symbol: 2, content: 1 };

// --- Text utilities --------------------------------------------------------

/**
 * Lowercase and clean for phrase matching: slashes/underscores/hyphens →
 * spaces, sentence punctuation (commas, parens, colons, sentence-ending
 * periods…) → spaces, but in-word tech symbols are kept so "c++", "c#",
 * "node.js", "p&l" and "a/b"→"a b" survive. Without this, a trailing comma
 * ("product strategy,") would defeat the space-padded phrase lookup.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\/_]+/g, " ")
    .replace(/[,;:!?()[\]{}"'`*•|]/g, " ") // sentence punctuation → space
    .replace(/\.(?=\s|$)/g, " ") // sentence-ending period → space (keeps node.js)
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

// Pure numbers and number-led tokens ("200b", "401k") are noise as keywords.
const isJunk = (t: string) => /^[0-9]/.test(t);

function haystackOf(normalized: string): string {
  return ` ${normalized} `;
}
function containsPhrase(haystack: string, phrase: string): boolean {
  return phrase.length > 0 && haystack.includes(` ${phrase} `);
}

/** Collect acronyms (QBR, ETL, S3, KPI…) from the ORIGINAL-case text. */
function acronymSet(originalText: string): Set<string> {
  const set = new Set<string>();
  const matches = originalText.match(/\b[A-Z][A-Za-z0-9]*[A-Z0-9]\b/g) ?? [];
  for (const m of matches) {
    if (/^[A-Z0-9]{2,6}$/.test(m)) set.add(m.toLowerCase());
  }
  return set;
}

/** Resolve inflected verbs (-s/-ing/-ed, incl. dropped-e) to an ACTION_VERB. */
function isActionVerb(token: string): boolean {
  if (ACTION_VERBS.has(token)) return true;
  const candidates = [
    token.replace(/s$/, ""),
    token.replace(/ing$/, ""),
    token.replace(/ing$/, "e"),
    token.replace(/ed$/, ""),
    token.replace(/ed$/, "e"),
  ];
  return candidates.some((c) => c.length >= 2 && ACTION_VERBS.has(c));
}

const freqBoost = (freq: number) => 1 + Math.min(freq - 1, 2) * 0.25;

function keywordWeight(token: string, acronyms: Set<string>): number {
  if (DOMAIN_TERMS.has(token)) return KEYWORD_WEIGHT.domain;
  if (acronyms.has(token)) return KEYWORD_WEIGHT.acronym;
  if (/[+#.&0-9]/.test(token)) return KEYWORD_WEIGHT.symbol;
  return KEYWORD_WEIGHT.content;
}

// --- Experience requirement parsing ----------------------------------------

type ExperienceReq = { min: number; max: number | null };

/**
 * Parse a years-of-experience requirement from the raw (lightly lowercased,
 * NOT hyphen-stripped) JD text, so ranges like "4-8 years" survive. When the
 * JD states several, the most demanding (highest minimum) wins.
 */
function parseExperience(rawLower: string): {
  req: ExperienceReq | null;
  label: string;
} {
  const cands: ExperienceReq[] = [];

  for (const m of rawLower.matchAll(
    /(\d{1,2})\s*(?:-|–|—|to)\s*(\d{1,2})\s*\+?\s*years?/g,
  )) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a <= b && b <= 40) cands.push({ min: a, max: b });
  }
  // Open-ended minimums. The negative lookbehind keeps these from re-reading a
  // number that's actually the upper bound of a range (e.g. the "8" in "4-8").
  for (const m of rawLower.matchAll(/(?<![\d.\-–—])(\d{1,2})\s*\+\s*years?/g)) {
    const a = Number(m[1]);
    if (a <= 40) cands.push({ min: a, max: null });
  }
  for (const m of rawLower.matchAll(
    /(?:at least|minimum(?:\s+of)?|min\.?)\s+(\d{1,2})\s+years?/g,
  )) {
    const a = Number(m[1]);
    if (a <= 40) cands.push({ min: a, max: null });
  }
  for (const m of rawLower.matchAll(
    /(?<![\d.\-–—])(\d{1,2})\s+years?(?:\s+of)?\s+(?:experience|exp|industry|professional|relevant|hands)/g,
  )) {
    const a = Number(m[1]);
    if (a <= 40) cands.push({ min: a, max: null });
  }

  if (cands.length === 0) return { req: null, label: "Not specified" };

  // Prefer an explicit range (it's the most precise statement of the ask),
  // then the most demanding minimum.
  cands.sort(
    (x, y) => (y.max != null ? 1 : 0) - (x.max != null ? 1 : 0) || y.min - x.min,
  );
  const req = cands[0];
  const label =
    req.max != null ? `${req.min}–${req.max} years` : `${req.min}+ years`;
  return { req, label };
}

type ExperienceScore = {
  points: number; // contribution to the 0–15 experience component
  reason: string; // card-ready alignment sentence
  scored: boolean; // false when the user hasn't configured their YOE
  jdUnspecified: boolean; // true when the JD states no years requirement
};

/**
 * Score the experience component (0–15) for the candidate's configured years of
 * experience vs the JD's ask, and produce a card-ready alignment sentence.
 *
 * `candidateYears === null` means the user hasn't set their years of experience
 * in Preferences. We then DON'T apply experience scoring (0 points,
 * `scored: false`); the caller both forgoes the 15 points (lower confidence)
 * and caps the score at 85% via `CAP.unknownCandidateExperience`.
 */
function scoreExperience(
  req: ExperienceReq | null,
  candidateYears: number | null,
): ExperienceScore {
  if (candidateYears === null) {
    return {
      points: 0,
      reason:
        "Set your years of experience in Preferences to factor experience alignment into this match.",
      scored: false,
      jdUnspecified: req === null,
    };
  }

  const c = candidateYears;

  if (!req) {
    return {
      points: 9,
      reason: "Experience requirement not specified.",
      scored: true,
      jdUnspecified: true,
    };
  }

  const { min, max } = req;
  const label = max != null ? `${min}–${max} years` : `${min}+ years`;
  const yrs = `${c} year${c === 1 ? "" : "s"}`;

  if (max != null) {
    if (c >= min && c <= max) {
      return {
        points: 15,
        reason: `Your ${yrs} aligns well with the requested ${label}.`,
        scored: true,
        jdUnspecified: false,
      };
    }
    if (c < min) {
      const gap = min - c;
      return {
        points: Math.max(2, 12 - gap * 3),
        reason: `This role requests ${label}; with ${yrs}, experience alignment is weaker.`,
        scored: true,
        jdUnspecified: false,
      };
    }
    // c > max
    const gap = c - max;
    if (max <= 3) {
      return {
        points: Math.max(3, 8 - gap),
        reason: `This role targets ${label} (early-career); at ${yrs} you're likely overqualified.`,
        scored: true,
        jdUnspecified: false,
      };
    }
    return {
      points: Math.max(6, 14 - gap * 2),
      reason: `Your ${yrs} is a little above the requested ${label} — still a solid fit.`,
      scored: true,
      jdUnspecified: false,
    };
  }

  // open-ended "min+"
  if (c >= min) {
    const over = c - min;
    if (over <= 1) {
      return {
        points: 15,
        reason: `Your ${yrs} aligns well with the requested ${label}.`,
        scored: true,
        jdUnspecified: false,
      };
    }
    if (over <= 4) {
      return {
        points: 13,
        reason: `Your ${yrs} aligns well with the requested ${label}.`,
        scored: true,
        jdUnspecified: false,
      };
    }
    return {
      points: 12,
      reason: `Your ${yrs} comfortably exceeds the requested ${label}.`,
      scored: true,
      jdUnspecified: false,
    };
  }

  const gap = min - c;
  return {
    points: Math.max(2, 13 - gap * 3),
    reason:
      gap >= 4
        ? `This role requests ${label}; with ${yrs}, experience alignment is weaker.`
        : `This role requests ${label}; with ${yrs}, experience alignment is somewhat weaker.`,
    scored: true,
    jdUnspecified: false,
  };
}

// --- Job model -------------------------------------------------------------

type WeightedTerm = { term: string; weight: number };

type Responsibility = {
  objects: string[]; // content object tokens (the "what")
  phrase: string; // objects joined — used for exact-phrase matching
  text: string; // "verb objects…" for display
  weight: number;
};

type JobModel = {
  keywords: WeightedTerm[];
  responsibilities: Responsibility[];
  corePhrases: WeightedTerm[]; // responsibility phrases + known phrases (for component B)
  titleRole: string[];
  titlePhrase: string;
  experienceReq: ExperienceReq | null;
  experienceLabel: string;
};

function buildJobModel(
  title: string,
  companyName: string,
  description: string,
): JobModel {
  const rawLower = `${title} ${description}`.toLowerCase();
  const original = `${title} ${title} ${description}`;
  const normalized = normalize(original);
  const tokens = tokenize(normalized);
  const acronyms = acronymSet(original);
  const excluded = new Set(tokenize(normalize(companyName)));
  const haystack = haystackOf(normalized);

  const isDomainToken = (t: string) =>
    t.includes(".") && !DOMAIN_TERMS.has(t) && /\.[a-z]{2,4}$/.test(t);

  const isContent = (t: string) =>
    t.length >= 2 &&
    !isJunk(t) &&
    !isDomainToken(t) &&
    !STOPWORDS.has(t) &&
    !GENERIC_WORDS.has(t) &&
    !excluded.has(t);

  // --- Keywords (single content tokens, weighted + frequency-boosted). -----
  const kwFreq = new Map<string, number>();
  for (const t of tokens) {
    if (!isContent(t)) continue;
    kwFreq.set(t, (kwFreq.get(t) ?? 0) + 1);
  }
  const keywords: WeightedTerm[] = [];
  for (const [term, freq] of kwFreq) {
    keywords.push({
      term,
      weight: keywordWeight(term, acronyms) * freqBoost(freq),
    });
  }
  keywords.sort((a, b) => b.weight - a.weight);

  // --- Responsibilities (verb-led phrases). --------------------------------
  const respByPhrase = new Map<string, Responsibility>();
  for (let i = 0; i < tokens.length; i++) {
    if (!isActionVerb(tokens[i])) continue;
    const objects: string[] = [];
    let j = i + 1;
    let bridged = false; // allow skipping one connective stopword between objects
    while (j < tokens.length && objects.length < 4) {
      const tk = tokens[j];
      if (isActionVerb(tk)) break;
      if (STOPWORDS.has(tk)) {
        if (objects.length > 0 && !bridged) {
          bridged = true;
          j++;
          continue;
        }
        break;
      }
      if (isContent(tk)) {
        objects.push(tk);
        j++;
        continue;
      }
      // generic (non-content) token: stop once we've started collecting
      if (objects.length > 0) break;
      j++;
    }
    if (objects.length >= 2) {
      const phrase = objects.join(" ");
      if (!respByPhrase.has(phrase)) {
        const weight = objects.reduce(
          (w, t) => w + (DOMAIN_TERMS.has(t) ? 2 : 1),
          0,
        );
        respByPhrase.set(phrase, {
          objects,
          phrase,
          text: `${tokens[i]} ${phrase}`,
          weight,
        });
      }
    }
    i = j - 1;
  }
  const responsibilities = [...respByPhrase.values()]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_RESPONSIBILITIES);

  // --- Core phrases for the exact-phrase component (B). These must be phrases
  //     that appear VERBATIM in the JD so a resume can contain them exactly:
  //     known phrases present, plus contiguous content bi/tri-grams. (The
  //     verb-led responsibility chunks above bridge stopwords, so they're used
  //     only for the fuzzy overlap component (C), never for exact matching.) --
  const phraseWeight = new Map<string, number>();
  const phraseFreq = new Map<string, number>();
  for (const p of KNOWN_PHRASES) {
    if (containsPhrase(haystack, p)) {
      phraseWeight.set(p, 6);
      phraseFreq.set(p, 1);
    }
  }
  for (let n = 2; n <= 3; n++) {
    for (let i = 0; i + n <= tokens.length; i++) {
      const gram = tokens.slice(i, i + n);
      if (!gram.every(isContent)) continue;
      // Only keep n-grams that are pure skill/tool/acronym clusters
      // (e.g. "kubernetes aws", "rest apis"). Windows that mix in ordinary
      // verbs/nouns (e.g. "experimentation manage stakeholder") span clause
      // boundaries in the stripped JD text — they're noise no resume contains
      // verbatim and would deflate exact-phrase coverage. Multi-word business
      // phrases ("product roadmap", "go to market") come from KNOWN_PHRASES.
      if (!gram.every((t) => DOMAIN_TERMS.has(t) || acronyms.has(t))) continue;
      const phrase = gram.join(" ");
      if (phraseWeight.has(phrase)) {
        phraseFreq.set(phrase, (phraseFreq.get(phrase) ?? 0) + 1);
        continue;
      }
      const base = n === 3 ? 5 : 4;
      phraseWeight.set(phrase, base + 1);
      phraseFreq.set(phrase, (phraseFreq.get(phrase) ?? 0) + 1);
    }
  }
  const corePhrases = [...phraseWeight.entries()]
    .map(([term, w]) => ({ term, weight: w * freqBoost(phraseFreq.get(term) ?? 1) }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_CORE_PHRASES);

  // --- Title role tokens (strip seniority modifiers + company, keep role). -
  const titleRole = tokenize(normalize(title)).filter(
    (t) =>
      t.length >= 2 &&
      !isJunk(t) &&
      !STOPWORDS.has(t) &&
      !SENIORITY_WORDS.has(t) &&
      !excluded.has(t),
  );

  const { req, label } = parseExperience(rawLower);

  return {
    keywords: keywords.slice(0, MAX_KEYWORDS),
    responsibilities,
    corePhrases,
    titleRole,
    titlePhrase: titleRole.join(" "),
    experienceReq: req,
    experienceLabel: label,
  };
}

// --- Resume prep -----------------------------------------------------------

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

type ResumePrep = { tokens: Set<string>; haystack: string };

// --- Title alignment -------------------------------------------------------

type TitleFit = "exact" | "strong" | "partial" | "mismatch" | "unknown";

function scoreTitle(
  titleRole: string[],
  titlePhrase: string,
  resume: ResumePrep,
): { points: number; fit: TitleFit } {
  if (titleRole.length === 0) return { points: 3, fit: "unknown" };
  if (containsPhrase(resume.haystack, titlePhrase)) {
    return { points: PTS.title, fit: "exact" };
  }
  const present = titleRole.filter((t) => resume.tokens.has(t));
  if (present.length === titleRole.length) return { points: 4, fit: "strong" };
  if (present.length > 0) {
    return {
      points: Math.max(2, Math.round(PTS.title * (present.length / titleRole.length))),
      fit: "partial",
    };
  }
  return { points: 0, fit: "mismatch" };
}

// --- Resume tweaks (truthful, never fabricating) ---------------------------

/** JD-vs-loose-synonym hints: fire only when the JD uses the precise term and
 * the resume uses the looser one, so the suggestion is always truthful. */
const SYNONYM_HINTS: Array<{ jd: string[]; resume: string; message: string }> = [
  {
    jd: ["qbr", "qbrs", "quarterly business review", "quarterly business reviews"],
    resume: "business review",
    message:
      'Your resume mentions business reviews, but this JD uses “QBRs” / “quarterly business reviews” — mirror that exact wording if it fits.',
  },
  {
    jd: ["go to market", "gtm"],
    resume: "marketing strategy",
    message:
      'The JD says “go-to-market (GTM)” where your resume says “marketing strategy” — consider mirroring the JD phrase if accurate.',
  },
  {
    jd: ["a b testing", "experimentation"],
    resume: "testing",
    message:
      'The JD emphasizes “A/B testing” / “experimentation” — use that exact phrasing if it reflects work you’ve done.',
  },
];

function buildTweaks(
  missingCorePhrases: string[],
  missingImportantKeywords: string[],
  jobHaystack: string,
  resume: ResumePrep,
): string[] {
  const tweaks: string[] = [];

  if (missingCorePhrases.length > 0) {
    tweaks.push(
      `If accurate, add the phrase “${missingCorePhrases[0]}” — the job description uses it directly.`,
    );
  }
  if (missingCorePhrases.length > 1) {
    tweaks.push(
      `Consider mirroring the JD phrase “${missingCorePhrases[1]}” if it reflects work you’ve actually done.`,
    );
  }

  // Synonym-mirroring hints (truthful by construction).
  for (const hint of SYNONYM_HINTS) {
    const jdUses = hint.jd.some((p) => containsPhrase(jobHaystack, p));
    const resumeUsesLoose = containsPhrase(resume.haystack, hint.resume);
    const resumeUsesExact = hint.jd.some((p) =>
      containsPhrase(resume.haystack, p),
    );
    if (jdUses && resumeUsesLoose && !resumeUsesExact) {
      tweaks.push(hint.message);
    }
  }

  if (missingImportantKeywords.length > 0) {
    const list = missingImportantKeywords
      .slice(0, 6)
      .map((k) => `“${k}”`)
      .join(", ");
    tweaks.push(
      `Your resume doesn’t surface ${list}. Add the ones you genuinely have hands-on experience with so the ATS sees an exact match.`,
    );
  }

  if (tweaks.length === 0) {
    tweaks.push(
      "Strong alignment — your resume already mirrors the job description’s key terms.",
    );
  }
  return tweaks.slice(0, 5);
}

// --- Score one resume against the job model --------------------------------

type ResumeScore = MatchDetail & { score: number };

function scoreResume(
  job: JobModel,
  jobHaystack: string,
  resume: ResumePrep,
  candidateYears: number | null,
): ResumeScore {
  // A) Exact ATS keyword hits — weighted recall over the core keyword set.
  const coreKw = job.keywords.slice(0, SCORE_KEYWORDS);
  let coreKwTotal = 0;
  let coreKwMatched = 0;
  for (const kw of coreKw) {
    coreKwTotal += kw.weight;
    if (resume.tokens.has(kw.term)) coreKwMatched += kw.weight;
  }
  const kwCoverage = coreKwTotal > 0 ? coreKwMatched / coreKwTotal : 0;
  const pointsKeywords = PTS.keywords * kwCoverage;

  const matchedAtsKeywords: string[] = [];
  const missingImportant: WeightedTerm[] = [];
  for (const kw of job.keywords) {
    if (resume.tokens.has(kw.term)) matchedAtsKeywords.push(kw.term);
    else if (kw.weight >= KEYWORD_WEIGHT.symbol) missingImportant.push(kw);
  }
  missingImportant.sort((a, b) => b.weight - a.weight);

  // B) Exact phrase matches from JD responsibilities (+ known phrases).
  const matchedExactPhrases: string[] = [];
  const missingCorePhrases: string[] = [];
  for (const ph of job.corePhrases) {
    if (containsPhrase(resume.haystack, ph.term)) matchedExactPhrases.push(ph.term);
    else missingCorePhrases.push(ph.term);
  }
  const corePhraseCoverage =
    job.corePhrases.length > 0
      ? matchedExactPhrases.length / job.corePhrases.length
      : 0;
  const pointsPhrases = PTS.phrases * corePhraseCoverage;

  // C) Core responsibility overlap — fuzzy token overlap of the top duties.
  const coreResp = job.responsibilities.slice(0, SCORE_RESPONSIBILITIES);
  const matchedResponsibilities: string[] = [];
  let coveredResp = 0;
  for (const r of coreResp) {
    const hit = r.objects.filter((t) => resume.tokens.has(t)).length;
    if (r.objects.length > 0 && hit / r.objects.length >= 0.5) {
      coveredResp++;
      matchedResponsibilities.push(r.text);
    }
  }
  const respCoverage = coreResp.length > 0 ? coveredResp / coreResp.length : 0;
  const pointsResponsibilities = PTS.responsibilities * respCoverage;

  // D) Experience range alignment.
  const exp = scoreExperience(job.experienceReq, candidateYears);

  // E) Seniority / title alignment.
  const title = scoreTitle(job.titleRole, job.titlePhrase, resume);

  const raw =
    pointsKeywords +
    pointsPhrases +
    pointsResponsibilities +
    exp.points +
    title.points;

  // --- Caps. 100 only when title + phrases + experience + duties are all
  //     excellent; otherwise the normal ceiling (92) and the situational caps.
  let cap = 100;
  const excellent =
    title.fit === "exact" &&
    corePhraseCoverage >= 0.8 &&
    exp.points >= 14 &&
    respCoverage >= 0.6 &&
    kwCoverage >= 0.8;
  if (!excellent) cap = Math.min(cap, CAP.normal);
  if (respCoverage < 0.34) cap = Math.min(cap, CAP.weakResponsibility);
  if (exp.jdUnspecified) cap = Math.min(cap, CAP.missingExperience);
  if (!exp.scored) cap = Math.min(cap, CAP.unknownCandidateExperience);
  if (title.fit === "mismatch") cap = Math.min(cap, CAP.titleMismatch);
  if (matchedExactPhrases.length === 0) cap = Math.min(cap, CAP.noStrongPhrase);

  const score = Math.max(0, Math.min(Math.round(raw), cap));

  // Short, factual one-liner for the card.
  const titlePrefix =
    title.fit === "exact"
      ? "Title matches. "
      : title.fit === "mismatch"
        ? "Title differs. "
        : "";
  const matchReason =
    `${titlePrefix}${matchedAtsKeywords.length} ATS keyword${matchedAtsKeywords.length === 1 ? "" : "s"} and ` +
    `${matchedExactPhrases.length} key phrase${matchedExactPhrases.length === 1 ? "" : "s"} matched; ` +
    `${coveredResp}/${coreResp.length} core responsibilities covered.`;

  return {
    score,
    matchedAtsKeywords: matchedAtsKeywords.slice(0, 40),
    matchedExactPhrases: matchedExactPhrases.slice(0, 25),
    matchedResponsibilities: matchedResponsibilities.slice(0, 12),
    missingImportantKeywords: missingImportant.slice(0, 12).map((t) => t.term),
    missingCorePhrases: missingCorePhrases.slice(0, 10),
    experienceRequirement: job.experienceLabel,
    experienceAlignmentReason: exp.reason,
    resumeTweaks: buildTweaks(
      missingCorePhrases,
      missingImportant.map((t) => t.term),
      jobHaystack,
      resume,
    ),
    matchReason,
  };
}

// --- Top level: best resume for a job --------------------------------------

const EMPTY_DETAIL: MatchDetail = {
  matchedAtsKeywords: [],
  matchedExactPhrases: [],
  matchedResponsibilities: [],
  missingImportantKeywords: [],
  missingCorePhrases: [],
  experienceRequirement: "Not specified",
  experienceAlignmentReason: "",
  resumeTweaks: [],
  matchReason: "",
};

export function matchJobToResumes(
  title: string,
  companyName: string | null,
  description: string | null,
  resumes: Array<ResumeDoc & { prepared: ResumePrep }>,
  candidateYears: number | null,
): BestMatch {
  if (resumes.length === 0) {
    return { score: null, bestResumeId: null, bestResumeTitle: null, ...EMPTY_DETAIL };
  }

  const job = buildJobModel(title, companyName ?? "", description ?? "");
  const jobHaystack = haystackOf(normalize(`${title} ${description ?? ""}`));

  let best: { resume: ResumeDoc & { prepared: ResumePrep }; result: ResumeScore } | null =
    null;
  for (const resume of resumes) {
    const result = scoreResume(job, jobHaystack, resume.prepared, candidateYears);
    if (!best || result.score > best.result.score) best = { resume, result };
  }

  if (!best) {
    return { score: 0, bestResumeId: null, bestResumeTitle: null, ...EMPTY_DETAIL };
  }

  const { resume, result } = best;
  const { score, ...detail } = result;
  return {
    score,
    bestResumeId: resume.id,
    bestResumeTitle: resume.title,
    ...detail,
  };
}
