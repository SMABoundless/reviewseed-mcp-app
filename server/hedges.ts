// Methodological search filters — "hedges" (docs/REPORTS-ROADMAP.md §3.11).
//
// SHARED LOGIC. The website has a behavioral twin (index.html's page-global
// HEDGES / applyHedge) and both run tests/fixtures/hedge-parity.json. The
// catalogue is also pinned in the generated shared-surface.json, so a hedge can't
// exist in one app and not the other.
//
// WHY THIS FILE IS CONSERVATIVE
//
// A hedge is a published artifact. Change one character of the Cochrane RCT
// filter and you silently change the recall of somebody's systematic review, and
// nobody will notice until peer review — or never. So:
//
//   1. Every string below was executed against the live API on 2026-08-01 and
//      confirmed to parse and to narrow a topic by a plausible margin. A filter
//      that errors, or that doesn't change the count, is a broken filter.
//   2. Every entry names its publisher and citation. A hedge without provenance
//      is a liability, not a feature.
//   3. `validated` is honest. It's true only for filters whose performance was
//      measured and published by their authors. A useful cluster of MeSH terms
//      that nobody has validated says so, in the data, and the UI shows it.
//   4. This is a point-in-time TRANSCRIPTION. Publishers revise filters. The
//      caveat travels with the catalogue and every consumer must show it.
import type { Source } from "./types.js";

export interface Hedge {
  id: string;
  source: Source;
  label: string;
  /** What the filter selects for, in one line. */
  purpose: string;
  /** The filter string, in the source's own syntax. */
  strategy: string;
  /** How it attaches to a query: AND'd in, or NOT'd out. */
  combine: "and" | "not";
  publisher: string;
  citation: string;
  /** True only if the publisher measured and reported its performance. */
  validated: boolean;
  /** The sensitivity/precision trade-off, so the choice is informed. */
  tradeoff: string;
}

export const HEDGE_CAVEAT =
  "Each filter below is a point-in-time transcription, verified to run on 2026-08-01. " +
  "Publishers revise filters — check the citation against the current published version before " +
  "relying on it in a review, and report the version you used.";

export const HEDGES: Hedge[] = [
  {
    id: "pubmed-rct-cochrane-sensitivity",
    source: "pubmed",
    label: "Randomised trials — sensitivity-maximising",
    purpose: "Finds randomised and controlled clinical trials, favouring recall over precision.",
    strategy: "randomized controlled trial[pt] OR controlled clinical trial[pt] OR randomized[tiab] OR placebo[tiab] OR clinical trials as topic[mesh:noexp] OR randomly[tiab] OR trial[ti] NOT (animals[mh] NOT humans[mh])",
    combine: "and",
    publisher: "Cochrane",
    citation: "Cochrane Handbook for Systematic Reviews of Interventions, ch. 4 — sensitivity-maximising version for PubMed",
    validated: true,
    tradeoff: "Built for recall: it will pull in non-trials, which is the intended cost. Don't use it to estimate how many trials exist.",
  },
  {
    id: "pubmed-systematic-reviews",
    source: "pubmed",
    label: "Systematic reviews (publication type)",
    purpose: "Restricts to records NLM has indexed as systematic reviews.",
    strategy: "systematic review[pt]",
    combine: "and",
    publisher: "U.S. National Library of Medicine",
    citation: "NLM publication type `systematic review`, introduced 2019",
    validated: true,
    tradeoff: "Precise but late: the type is assigned during indexing, so recent and unindexed records are missed. For a full review, pair it with free-text terms.",
  },
  {
    id: "pubmed-humans-only",
    source: "pubmed",
    label: "Human studies only",
    purpose: "Restricts to records indexed with the Humans heading.",
    strategy: "humans[mesh]",
    combine: "and",
    publisher: "U.S. National Library of Medicine",
    citation: "MeSH heading `Humans`",
    validated: true,
    tradeoff: "Drops anything not yet MeSH-indexed, including most recent records. The animal-exclusion filter below is the gentler option.",
  },
  {
    id: "pubmed-exclude-animal-only",
    source: "pubmed",
    label: "Exclude animal-only studies",
    purpose: "Removes records indexed for animals but not humans, keeping unindexed records.",
    strategy: "(animals[mh] NOT humans[mh])",
    combine: "not",
    publisher: "Cochrane",
    citation: "Cochrane Handbook for Systematic Reviews of Interventions, ch. 4 — the exclusion used in its own trial filters",
    validated: true,
    tradeoff: "Safer than requiring Humans: it only removes records positively indexed as animal-only, so unindexed records survive.",
  },
  {
    id: "pubmed-observational-designs",
    source: "pubmed",
    label: "Observational designs (unvalidated cluster)",
    purpose: "Gathers the common observational study designs by type and MeSH heading.",
    strategy: "observational study[pt] OR cohort studies[mh] OR case-control studies[mh] OR cross-sectional studies[mh]",
    combine: "and",
    publisher: "none — assembled from NLM publication types and MeSH headings",
    citation: "Not a published filter. Assembled for convenience from `observational study[pt]`, `cohort studies[mh]`, `case-control studies[mh]`, `cross-sectional studies[mh]`.",
    validated: false,
    tradeoff: "NOT a validated filter: nobody has measured its recall. Use it to explore, and build your own from the designs your question needs before relying on it.",
  },
  {
    id: "eric-peer-reviewed",
    source: "eric",
    label: "Peer-reviewed only",
    purpose: "Restricts to records ERIC flags as peer reviewed.",
    strategy: "peerreviewed:T",
    combine: "and",
    publisher: "Institute of Education Sciences (ERIC)",
    citation: "ERIC `peerreviewed` field",
    validated: true,
    tradeoff: "Excludes the grey literature — reports, dissertations, conference papers — that ERIC is unusually good for. Deliberate choice, not a default.",
  },
  {
    id: "eric-full-text",
    source: "eric",
    label: "Full text available in ERIC",
    purpose: "Restricts to records with ERIC-hosted full text.",
    strategy: "e_fulltextauth:1",
    combine: "and",
    publisher: "Institute of Education Sciences (ERIC)",
    citation: "ERIC `e_fulltextauth` field",
    validated: true,
    tradeoff: "Convenience, not comprehensiveness: it filters by what ERIC can hand you, which is unrelated to relevance. Poor fit for a systematic search.",
  },
  {
    id: "eric-higher-education",
    source: "eric",
    label: "Higher education level",
    purpose: "Restricts to records assigned the Higher Education level.",
    strategy: 'educationlevel:"Higher Education"',
    combine: "and",
    publisher: "Institute of Education Sciences (ERIC)",
    citation: "ERIC `educationlevel` field, Thesaurus value `Higher Education`",
    validated: true,
    tradeoff: "Depends on level being assigned during indexing; records without it drop out even when they're about universities.",
  },
  {
    id: "trials-interventional",
    source: "trials",
    label: "Interventional studies only",
    purpose: "Restricts to interventional (as opposed to observational) trial registrations.",
    strategy: "AREA[StudyType]INTERVENTIONAL",
    combine: "and",
    publisher: "ClinicalTrials.gov",
    citation: "ClinicalTrials.gov `StudyType` field, value `INTERVENTIONAL`",
    validated: true,
    tradeoff: "Registry metadata, applied by the sponsor at registration, so it's as accurate as the registration was.",
  },
];

export const hedgesFor = (source: Source): Hedge[] => HEDGES.filter(h => h.source === source);
export const getHedge = (id: string): Hedge | undefined => HEDGES.find(h => h.id === id);

/**
 * Attach a hedge to a query. The query is always parenthesised: a hedge is a
 * chain of ORs, and AND'ing it onto an unwrapped query would silently rebind the
 * operators — the failure mode that makes a filtered search quietly wrong.
 */
export function applyHedge(query: string, hedge: Hedge): string {
  const q = (query || "").replace(/\n/g, " ").trim();
  if (!q) return hedge.combine === "not" ? "" : `(${hedge.strategy})`;
  return `(${q}) ${hedge.combine === "not" ? "NOT" : "AND"} (${hedge.strategy})`;
}
