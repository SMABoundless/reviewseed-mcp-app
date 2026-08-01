// Terminology drift (docs/REPORTS-ROADMAP.md §3.9).
//
// SHARED LOGIC. The website has a behavioral twin (index.html's page-globals
// parseHistoryNote / assessDrift) and both run tests/fixtures/drift-parity.json.
//
// PURE: the network fetch is per-surface; everything here is string work.
//
// THE PROBLEM: a MeSH heading only retrieves records indexed after NLM created
// it. Search "Mindfulness"[MeSH] and you get nothing before 2014 — not because
// the literature is absent, but because indexers had no such heading. For a
// review claiming complete coverage, that's a silent hole.
//
// WHAT NLM ACTUALLY EXPOSES (verified against the live SPARQL endpoint
// 2026-08-01 — the predicates are NOT the ones you'd guess):
//   meshv:dateIntroduced  — e.g. "2014-01-01". Authoritative and machine-readable.
//   meshv:historyNote     — NLM's own prose, e.g.
//                           "1990 (1983); use STRESS, PSYCHOLOGICAL 1983-1989"
//   meshv:lastUpdated     — not useful here.
// There is no `dateCreated` and no `previousIndexing` predicate, despite both
// appearing in older MeSH documentation.
//
// HOW MUCH WE TRUST EACH: `dateIntroduced` is the year we report. The history
// note is parsed ONLY for "use <HEADING> <years>" clauses, because those name
// the heading to search instead for earlier years — the actionable part. The
// note's own leading year is deliberately ignored: observed live, it sometimes
// disagrees with dateIntroduced (Health Disparate… says 2022 vs 2023), and
// guessing which is right would be inventing a fact. The raw note always travels
// with the finding so a librarian can read it themselves.

/** MEDLINE's beginning. A heading this old has no terminology gap worth reporting. */
export const MESH_BASELINE_YEAR = 1966;

export interface PriorHeading {
  /** The heading NLM says to use instead, verbatim from the note. */
  heading: string;
  from: number | null;
  to: number | null;
}

export interface HistoryNote {
  raw: string;
  priorHeadings: PriorHeading[];
  /** True when there was note text we could not parse into a clause. */
  hasUnparsedText: boolean;
}

/**
 * Two-digit years in these notes are always 20th century: MeSH began in the
 * 1960s and every note using two digits predates 2000 (verified across a live
 * sample — modern notes use four digits).
 */
function expandYear(y: string): number | null {
  const n = parseInt(y, 10);
  if (!Number.isFinite(n)) return null;
  return y.length === 2 ? 1900 + n : n;
}

/**
 * Parse the "use X" clauses out of a history note.
 *
 * Handles the shapes observed live:
 *   "use FERMENTED FOODS AND BEVERAGES 2020-2021"
 *   "use CHOLINEPHOSPHOTRANSFERASE 1975-93"
 *   "for DATA SOURCES use INFORMATION STORAGE AND RETRIEVAL 1986-2022"
 *   "use Health Disparity, Minority and Vulnerable Populations 2022"
 *
 * In the "for A use B" form, B is what to search — A is a different concept that
 * was folded in, and is deliberately ignored rather than guessed about.
 */
export function parseHistoryNote(raw: string): HistoryNote {
  const text = String(raw ?? "").trim();
  if (!text) return { raw: "", priorHeadings: [], hasUnparsedText: false };

  const priorHeadings: PriorHeading[] = [];
  let matchedChars = 0;
  // Heading text runs up to the trailing year range. Non-greedy, and anchored on
  // "use " so "for A use B" yields B.
  const re = /\buse\s+(.+?)\s+(\d{2,4})(?:\s*-\s*(\d{2,4}))?(?=[;.]|$)/gi;
  for (const m of text.matchAll(re)) {
    priorHeadings.push({
      heading: m[1].trim(),
      from: expandYear(m[2]),
      to: m[3] ? expandYear(m[3]) : expandYear(m[2]),
    });
    matchedChars += m[0].length;
  }
  // Strip the leading-year prefix ("1990 (1983);", "84(77);") before deciding
  // whether anything meaningful went unparsed — that prefix is expected and is
  // not something we claim to interpret.
  const withoutPrefix = text.replace(/^\s*\d{2,4}\s*(\(\s*\d{2,4}\s*\))?\s*;?\s*/, "");
  const leftover = withoutPrefix.length - matchedChars;
  return { raw: text, priorHeadings, hasUnparsedText: leftover > 12 };
}

export interface DriftInput {
  label: string;
  /** meshv:dateIntroduced, e.g. "2014-01-01". */
  dateIntroduced?: string | null;
  historyNote?: string | null;
  /**
   * First year the search claims to cover. null means no date limit — which
   * means the search reaches back indefinitely, so a gap is MORE relevant, not
   * less.
   */
  coverageFrom?: number | null;
}

export interface DriftFinding {
  label: string;
  introducedYear: number | null;
  /** "gap" | "covered" | "baseline" | "unknown" */
  verdict: "gap" | "covered" | "baseline" | "unknown";
  priorHeadings: PriorHeading[];
  historyNote: string;
  hasUnparsedNote: boolean;
  message: string;
}

export function assessDrift(input: DriftInput): DriftFinding {
  const { label, dateIntroduced, historyNote, coverageFrom = null } = input;
  const note = parseHistoryNote(historyNote ?? "");
  const year = dateIntroduced ? parseInt(String(dateIntroduced).slice(0, 4), 10) : NaN;
  const introducedYear = Number.isFinite(year) ? year : null;
  const base = {
    label,
    introducedYear,
    priorHeadings: note.priorHeadings,
    historyNote: note.raw,
    hasUnparsedNote: note.hasUnparsedText,
  };

  if (introducedYear === null) {
    return { ...base, verdict: "unknown",
      message: `NLM records no introduction date for ${label}, so its coverage span can't be checked here. Look it up in the MeSH Browser before claiming complete coverage.` };
  }
  if (introducedYear <= MESH_BASELINE_YEAR) {
    return { ...base, verdict: "baseline",
      message: `${label} has been available since MEDLINE's own beginning (${introducedYear}), so it introduces no terminology gap.` };
  }

  const priorText = note.priorHeadings.length
    ? ` NLM's note says to use ${note.priorHeadings.map(p => `${p.heading}${p.from ? ` (${p.from}${p.to && p.to !== p.from ? `–${p.to}` : ""})` : ""}`).join("; ")} for the earlier years.`
    : " NLM's note names no replacement heading, so free-text terms are the only way to reach the earlier literature.";

  if (coverageFrom !== null && coverageFrom >= introducedYear) {
    return { ...base, verdict: "covered",
      message: `${label} was introduced in ${introducedYear}, and your search starts in ${coverageFrom}, so nothing is lost to terminology here.` };
  }
  // Phrased two ways on purpose: "Records from everything before 1987" reads as a
  // typo, which is what the first version produced.
  const span = coverageFrom !== null
    ? `Records from ${coverageFrom}–${introducedYear - 1}`
    : `Records published before ${introducedYear}`;
  return { ...base, verdict: "gap",
    message: `${label} was introduced in ${introducedYear}. ${span} were never indexed with it, so this heading cannot retrieve them.${priorText}` };
}

export interface DriftReport {
  findings: DriftFinding[];
  coverageFrom: number | null;
  counts: { gap: number; covered: number; baseline: number; unknown: number };
  summary: string;
}

export function buildDriftReport(inputs: DriftInput[], coverageFrom: number | null = null): DriftReport {
  const findings = inputs.map(i => assessDrift({ ...i, coverageFrom }));
  const counts = {
    gap: findings.filter(f => f.verdict === "gap").length,
    covered: findings.filter(f => f.verdict === "covered").length,
    baseline: findings.filter(f => f.verdict === "baseline").length,
    unknown: findings.filter(f => f.verdict === "unknown").length,
  };
  const summary = !findings.length
    ? "No MeSH headings in the pool, so there is nothing to check."
    : counts.gap === 0
      ? "No heading in this pool introduces a coverage gap for the years you're searching."
      : `${counts.gap} of ${findings.length} heading${findings.length === 1 ? "" : "s"} cannot reach part of the period you're searching. ` +
        "That's a gap in the indexing, not in the literature — free-text terms, or the earlier heading NLM names, close it.";
  return { findings, coverageFrom, counts, summary };
}

/** SPARQL for one descriptor's history. Kept here so both surfaces send the same query. */
export function meshHistoryQuery(id: string): string {
  return `PREFIX meshv: <http://id.nlm.nih.gov/mesh/vocab#> PREFIX mesh: <http://id.nlm.nih.gov/mesh/> ` +
    `SELECT ?intro ?hist WHERE { OPTIONAL { mesh:${id} meshv:dateIntroduced ?intro } ` +
    `OPTIONAL { mesh:${id} meshv:historyNote ?hist } }`;
}
