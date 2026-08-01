// Cross-vocabulary crosswalk: MeSH ↔ ERIC (docs/REPORTS-ROADMAP.md §3.3).
//
// SHARED LOGIC. The website has a behavioral twin (index.html's page-globals
// normalizeVocabLabel / crosswalkCandidates) and both run
// tests/fixtures/crosswalk-parity.json.
//
// PURE and offline: the ERIC Thesaurus snapshot is already loaded by both apps.
//
// WHY THIS EXISTS: a question about education and health has to be searched in
// both PubMed and ERIC, and the two vocabularies were built by different people
// for different literatures. Nothing official maps between them.
//
// WHICH IS EXACTLY WHY EVERY OUTPUT IS A CANDIDATE, NOT A MAPPING.
//
// The case that settled the design: MeSH has `Mindfulness`; ERIC has no such
// descriptor, but `Metacognition` lists "Mindfulness" as a Use-For synonym —
// ERIC folded the cognitive-psychology sense of the word into Metacognition. So
// the strongest available signal produces a suggestion that is *conceptually
// wrong* for mindfulness-as-meditation. A tool that presented that as a mapping
// would send someone's education search off a cliff. Hence: tiered confidence,
// the evidence for every match spelled out, and a report that says out loud that
// a human must confirm each one.
interface ThesaurusLikeEntry { u?: string[] }

export type MatchKind =
  | "same-label"
  | "mesh-label-is-eric-synonym"
  | "mesh-entry-is-eric-label"
  | "mesh-head-is-eric-label"
  | "mesh-entry-is-eric-synonym";

export type Confidence = "strong" | "likely" | "possible";

export interface CrosswalkMatch {
  descriptor: string;
  kind: MatchKind;
  confidence: Confidence;
  /** Exactly which strings matched, so the suggestion can be judged. */
  evidence: string;
}

export interface CrosswalkResult {
  meshLabel: string;
  matches: CrosswalkMatch[];
  /** True when nothing matched — often the right answer, not a failure. */
  none: boolean;
}

/**
 * Normalise a vocabulary label for comparison.
 *
 * ERIC qualifies with parentheses (`Depression (Psychology)`); MeSH inverts with
 * commas (`Burnout, Professional`). Both are stripped, but they are NOT
 * equivalent operations — see `meshHead` below, which is deliberately a weaker
 * signal.
 */
export function normalizeVocabLabel(label: string): string {
  return String(label ?? "")
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*$/, "")   // ERIC's trailing qualifier
    .replace(/[.,;:]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The head noun of an inverted MeSH heading: `Burnout, Professional` → `burnout`.
 *
 * MeSH inverts so the broader noun sorts first, which makes the head a real
 * signal — but a broadening one. `Aged, 80 and over` heads to `aged`, which is a
 * different concept, so this can only ever be a `possible` match.
 */
export function meshHead(label: string): string | null {
  const norm = normalizeVocabLabel(label);
  if (!norm.includes(",")) return null;
  const head = norm.split(",")[0].trim();
  return head && head !== norm ? head : null;
}

const CONFIDENCE_BY_KIND: Record<MatchKind, Confidence> = {
  "same-label": "strong",
  "mesh-label-is-eric-synonym": "likely",
  "mesh-entry-is-eric-label": "likely",
  "mesh-head-is-eric-label": "possible",
  "mesh-entry-is-eric-synonym": "possible",
};

const RANK: Record<Confidence, number> = { strong: 0, likely: 1, possible: 2 };

/**
 * Find ERIC descriptors that might correspond to a MeSH heading.
 *
 * `thesaurus` is the shipped snapshot: descriptor label -> { u: Use-For synonyms }.
 * Only the strongest match per descriptor is kept, so one descriptor can't appear
 * three times with three rationales.
 */
export function crosswalkCandidates(
  meshLabel: string,
  meshEntryTerms: string[] = [],
  thesaurus: Record<string, ThesaurusLikeEntry> = {},
): CrosswalkResult {
  const target = normalizeVocabLabel(meshLabel);
  const head = meshHead(meshLabel);
  const entries = meshEntryTerms.map(normalizeVocabLabel).filter(e => e && e !== target);

  const best = new Map<string, CrosswalkMatch>();
  const offer = (descriptor: string, kind: MatchKind, evidence: string) => {
    const candidate: CrosswalkMatch = { descriptor, kind, confidence: CONFIDENCE_BY_KIND[kind], evidence };
    const cur = best.get(descriptor);
    if (!cur || RANK[candidate.confidence] < RANK[cur.confidence]) best.set(descriptor, candidate);
  };

  for (const [descriptor, entry] of Object.entries(thesaurus)) {
    const dnorm = normalizeVocabLabel(descriptor);
    const synonyms = (entry?.u ?? []).map(u => ({ raw: u, norm: normalizeVocabLabel(u) }));

    if (dnorm === target) {
      offer(descriptor, "same-label", `Both vocabularies use this label${descriptor.toLowerCase() !== meshLabel.toLowerCase() ? ` (ERIC writes it "${descriptor}")` : ""}.`);
      continue; // nothing can beat a label match
    }
    const synHit = synonyms.find(sy => sy.norm === target);
    if (synHit) {
      offer(descriptor, "mesh-label-is-eric-synonym",
        `ERIC lists "${synHit.raw}" as a Use-For synonym of "${descriptor}" — meaning ERIC folds this concept INTO that descriptor, which may or may not be the sense you want.`);
    }
    if (entries.includes(dnorm)) {
      const which = meshEntryTerms.find(e => normalizeVocabLabel(e) === dnorm);
      offer(descriptor, "mesh-entry-is-eric-label",
        `The MeSH entry term "${which}" is an ERIC descriptor in its own right.`);
    }
    if (head && dnorm === head) {
      offer(descriptor, "mesh-head-is-eric-label",
        `"${meshLabel}" is an inverted MeSH heading whose head noun is "${head}", which ERIC uses as a descriptor. Broader than the MeSH heading.`);
    }
    for (const sy of synonyms) {
      if (entries.includes(sy.norm)) {
        const which = meshEntryTerms.find(e => normalizeVocabLabel(e) === sy.norm);
        offer(descriptor, "mesh-entry-is-eric-synonym",
          `The MeSH entry term "${which}" appears as a Use-For synonym of ERIC's "${descriptor}".`);
      }
    }
  }

  const matches = [...best.values()].sort((a, b) =>
    RANK[a.confidence] - RANK[b.confidence] || a.descriptor.localeCompare(b.descriptor));
  return { meshLabel, matches, none: matches.length === 0 };
}

export const CROSSWALK_CAVEAT =
  "No official MeSH–ERIC mapping exists. These are CANDIDATES found by comparing labels and synonyms, and each " +
  "needs a human to confirm it. A synonym match is the least trustworthy kind: ERIC sometimes folds a term into a " +
  "broader descriptor, so the word can match while the concept does not.";

export interface CrosswalkReport {
  results: CrosswalkResult[];
  counts: { withMatches: number; withoutMatches: number; strong: number; likely: number; possible: number };
  caveat: string;
  summary: string;
}

export function buildCrosswalkReport(results: CrosswalkResult[]): CrosswalkReport {
  const all = results.flatMap(r => r.matches);
  const counts = {
    withMatches: results.filter(r => !r.none).length,
    withoutMatches: results.filter(r => r.none).length,
    strong: all.filter(m => m.confidence === "strong").length,
    likely: all.filter(m => m.confidence === "likely").length,
    possible: all.filter(m => m.confidence === "possible").length,
  };
  const summary = !results.length
    ? "No MeSH headings in the pool, so there is nothing to cross-walk."
    : counts.withMatches === 0
      ? "None of these headings has an obvious ERIC counterpart. That is a real answer: the two vocabularies cover different literatures, and a concept can simply be absent from one."
      : `${counts.withMatches} of ${results.length} heading${results.length === 1 ? " has" : "s have"} at least one ERIC candidate. Confirm each before searching with it — especially the synonym matches.`;
  return { results, counts, caveat: CROSSWALK_CAVEAT, summary };
}
