// Query tuning ladder (docs/REPORTS-ROADMAP.md §3.7).
//
// SHARED LOGIC. The website has a behavioral twin (index.html's page-global
// buildQueryVariants) and both run tests/fixtures/variant-parity.json.
//
// PURE: generates the strings. Running them is per-surface — the website counts
// them through its cached countOnly, the MCP app through compare_queries.
//
// WHAT THIS IS FOR: a search string is a set of choices — headings or free text,
// title-only or all fields, OR or AND — and each choice trades recall for
// precision. The ladder makes the trade visible by building the neighbouring
// versions of your own query and counting them, so "what does this term cost me?"
// has a number instead of an intuition.
//
// Every variant is built by the SAME buildBooleanQuery the app uses, never by
// string surgery on the finished query. A variant assembled differently from the
// real thing would be measuring something else.
//
// CONCEPT STRUCTURE. A flat pool is ONE concept (everything OR'd). A question
// with several concepts lives in a framework, so every function here takes an
// optional `framework`: the rungs are then built by buildFrameworkQuery — OR
// within a bucket, AND across buckets — and the ladder varies the terms inside
// that structure instead of flattening it. Without this, a four-concept pool
// "as built" is an OR of everything, and its rungs measure nothing useful.
import { activeConcepts, buildBooleanQuery, buildFrameworkQuery, type FrameworkSpec, type KwFields, type Pool } from "./query.js";
import type { Source } from "./types.js";

/** buildBooleanQuery's operator options, named here so the ladder can vary them. */
export type BooleanOpts = { kwOp?: "OR" | "AND"; vocabOp?: "OR" | "AND"; joinOp?: "AND" | "OR" };

export interface Variant {
  key: string;
  label: string;
  /** What question this variant answers. */
  rationale: string;
  query: string;
  /** Framework mode only: concepts with no terms left in this rung, which
   *  therefore drop out of the AND. The rung is then not a clean subset. */
  droppedConcepts?: string[];
}

export interface SkippedVariant {
  key: string;
  label: string;
  /** Why it wasn't generated — never dropped silently. */
  reason: string;
}

export interface VariantSet {
  variants: Variant[];
  skipped: SkippedVariant[];
}

const withAllPools = (p: Pool): Pool => ({
  keywords: p.keywords ?? [], mesh: p.mesh ?? [], eric: p.eric ?? [],
  queries: p.queries ?? [], ericQueries: p.ericQueries ?? [], ctQueries: p.ctQueries ?? [],
});

/** Force every keyword to one field tag, leaving other kinds untouched. */
function forceFields(pool: Pool, tag: string): KwFields {
  const out: KwFields = {};
  for (const k of pool.keywords ?? []) out[k] = tag;
  return out;
}

/**
 * Build the neighbouring versions of a query.
 *
 * A variant is omitted when it cannot differ from the query as built — no
 * keywords means no keywords-only rung — and every omission is reported with its
 * reason, because a ladder with silently missing rungs reads as a complete
 * comparison when it isn't.
 */
export function buildQueryVariants(
  pool: Pool,
  kwFields: KwFields = {},
  opts: BooleanOpts = {},
  source: Source = "pubmed",
  framework?: FrameworkSpec,
): VariantSet {
  const p = withAllPools(pool);
  const build = (pl: Pool, kf: KwFields, o: BooleanOpts) => framework
    ? buildFrameworkQuery(framework.key, framework.buckets, pl, kf, source)
    : buildBooleanQuery(pl, kf, o, source);
  // In framework mode only bucketed terms are in the query, so only they count
  // when deciding whether a rung can differ from the baseline.
  const concepts = framework ? activeConcepts(framework, p, source) : [];
  const placed = new Set(concepts.flatMap(c => c.terms));
  const inQuery = (t: string) => !framework || placed.has(t);
  const kw = (p.keywords ?? []).filter(inQuery);
  const vocab = [...(p.mesh ?? []), ...(p.eric ?? [])].filter(inQuery);

  const asBuilt = build(p, kwFields, opts);
  const variants: Variant[] = [];
  const skipped: SkippedVariant[] = [];

  variants.push({
    key: "as-built",
    label: "As built",
    rationale: "Your current string — the baseline every other rung is measured against.",
    query: asBuilt,
  });

  // `pl` is the pool the rung was built from, so a framework rung can report
  // the concepts it lost.
  const add = (key: string, label: string, rationale: string, pl: Pool, kf: KwFields, o: BooleanOpts, skipReason?: string) => {
    if (skipReason) { skipped.push({ key, label, reason: skipReason }); return; }
    const query = build(pl, kf, o);
    if (!query.trim()) { skipped.push({ key, label, reason: "Would produce an empty query." }); return; }
    if (query === asBuilt) { skipped.push({ key, label, reason: "Identical to the query as built, so it would measure nothing." }); return; }
    if (framework) {
      const kept = new Set(activeConcepts(framework, pl, source).map(c => c.key));
      const dropped = concepts.filter(c => !kept.has(c.key)).map(c => c.label);
      if (dropped.length) {
        variants.push({
          key, label, query, droppedConcepts: dropped,
          rationale: `${rationale} CAUTION: ${dropped.join(", ")} ${dropped.length === 1 ? "has" : "have"} no terms of this kind, ` +
            "so that concept drops out of the AND here. This rung can be LARGER than the baseline and is not a clean subset of it.",
        });
        return;
      }
    }
    variants.push({ key, label, rationale, query });
  };

  add("vocab-only", "Subject headings only",
    "How much of your result set rests on controlled vocabulary alone — the precise half.",
    { ...p, keywords: [] }, kwFields, opts,
    kw.length === 0 ? "No keywords pooled, so this is already the query as built." : undefined);

  add("keywords-only", "Free text only",
    "How much rests on free text alone — the half that reaches unindexed and recent records.",
    { ...p, mesh: [], eric: [] }, kwFields, opts,
    vocab.length === 0 ? "No subject headings pooled, so this is already the query as built." : undefined);

  add("keywords-all-fields", "Free text broadened to all fields",
    "The recall ceiling for your keywords: what searching every field, not just title and abstract, would add.",
    p, forceFields(p, "all"), opts,
    kw.length === 0 ? "No keywords to broaden." : undefined);

  add("keywords-title-only", "Free text narrowed to titles",
    "The precision floor: how much survives if a keyword must appear in the title.",
    p, forceFields(p, "ti"), opts,
    kw.length === 0 ? "No keywords to narrow." : undefined);

  add("keywords-and", "Free text joined with AND",
    "What happens if every keyword must be present rather than any — usually a steep drop, and a precision test.",
    p, kwFields, { ...opts, kwOp: "AND" },
    framework ? "Not applicable to a framework query: terms inside a concept are always OR'd, and the concepts are already AND'd."
      : kw.length < 2 ? "Needs at least two keywords for AND to differ from OR." : undefined);

  return { variants, skipped };
}

/** One term's marginal contribution: the same pool minus that term. */
export interface LeaveOneOutVariant {
  term: string;
  pool: "keywords" | "mesh" | "eric";
  query: string;
  /** True when removing it leaves nothing to run. */
  empty: boolean;
  /** Framework mode only: the term is the last one in this concept, so removing
   *  it removes the concept and BROADENS the query. Its marginal yield cannot
   *  be read from this variant. */
  soleInConcept?: string;
}

/**
 * The query without each term in turn. Compared against the as-built total, the
 * difference is that term's marginal yield: how many records it alone brings in.
 *
 * A term whose removal changes nothing is a candidate for pruning — but only for
 * THIS pool, since terms overlap; dropping two zero-yield terms can still lose
 * records that only they shared.
 *
 * With a `framework`, the query is rebuilt with its concept structure intact and
 * only terms placed in a bucket are tested (an unplaced term is not in the query).
 */
export function leaveOneOutVariants(
  pool: Pool,
  kwFields: KwFields = {},
  opts: BooleanOpts = {},
  source: Source = "pubmed",
  framework?: FrameworkSpec,
): LeaveOneOutVariant[] {
  const p = withAllPools(pool);
  const concepts = framework ? activeConcepts(framework, p, source) : [];
  const placed = new Set(concepts.flatMap(c => c.terms));
  const inQuery = (t: string) => !framework || placed.has(t);
  const targets: Array<{ term: string; pool: "keywords" | "mesh" | "eric" }> = [
    ...(p.keywords ?? []).filter(inQuery).map(term => ({ term, pool: "keywords" as const })),
    ...(p.mesh ?? []).filter(inQuery).map(term => ({ term, pool: "mesh" as const })),
    ...(p.eric ?? []).filter(inQuery).map(term => ({ term, pool: "eric" as const })),
  ];
  return targets.map(t => {
    const without = { ...p, [t.pool]: (p[t.pool] ?? []).filter(x => x !== t.term) };
    const query = framework
      ? buildFrameworkQuery(framework.key, framework.buckets, without, kwFields, source)
      : buildBooleanQuery(without, kwFields, opts, source);
    const out: LeaveOneOutVariant = { term: t.term, pool: t.pool, query, empty: !query.trim() };
    if (framework) {
      const kept = new Set(activeConcepts(framework, without, source).map(c => c.key));
      const lost = concepts.find(c => !kept.has(c.key));
      if (lost) out.soleInConcept = lost.label;
    }
    return out;
  });
}

/** Exact overlap between two strings: one count, no sampling. */
export const overlapQuery = (a: string, b: string): string =>
  !a.trim() || !b.trim() ? "" : `(${a.replace(/\n/g, " ").trim()}) AND (${b.replace(/\n/g, " ").trim()})`;
