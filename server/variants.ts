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
import { buildBooleanQuery, type KwFields, type Pool } from "./query.js";
import type { Source } from "./types.js";

/** buildBooleanQuery's operator options, named here so the ladder can vary them. */
export type BooleanOpts = { kwOp?: "OR" | "AND"; vocabOp?: "OR" | "AND"; joinOp?: "AND" | "OR" };

export interface Variant {
  key: string;
  label: string;
  /** What question this variant answers. */
  rationale: string;
  query: string;
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
): VariantSet {
  const p = withAllPools(pool);
  const kw = p.keywords ?? [];
  const vocab = [...(p.mesh ?? []), ...(p.eric ?? [])];
  const build = (pl: Pool, kf: KwFields, o: BooleanOpts) => buildBooleanQuery(pl, kf, o, source);

  const asBuilt = build(p, kwFields, opts);
  const variants: Variant[] = [];
  const skipped: SkippedVariant[] = [];

  variants.push({
    key: "as-built",
    label: "As built",
    rationale: "Your current string — the baseline every other rung is measured against.",
    query: asBuilt,
  });

  const add = (key: string, label: string, rationale: string, query: string, skipReason?: string) => {
    if (skipReason) { skipped.push({ key, label, reason: skipReason }); return; }
    if (!query.trim()) { skipped.push({ key, label, reason: "Would produce an empty query." }); return; }
    if (query === asBuilt) { skipped.push({ key, label, reason: "Identical to the query as built, so it would measure nothing." }); return; }
    variants.push({ key, label, rationale, query });
  };

  add("vocab-only", "Subject headings only",
    "How much of your result set rests on controlled vocabulary alone — the precise half.",
    build({ ...p, keywords: [] }, kwFields, opts),
    kw.length === 0 ? "No keywords pooled, so this is already the query as built." : undefined);

  add("keywords-only", "Free text only",
    "How much rests on free text alone — the half that reaches unindexed and recent records.",
    build({ ...p, mesh: [], eric: [] }, kwFields, opts),
    vocab.length === 0 ? "No subject headings pooled, so this is already the query as built." : undefined);

  add("keywords-all-fields", "Free text broadened to all fields",
    "The recall ceiling for your keywords: what searching every field, not just title and abstract, would add.",
    build(p, forceFields(p, "all"), opts),
    kw.length === 0 ? "No keywords to broaden." : undefined);

  add("keywords-title-only", "Free text narrowed to titles",
    "The precision floor: how much survives if a keyword must appear in the title.",
    build(p, forceFields(p, "ti"), opts),
    kw.length === 0 ? "No keywords to narrow." : undefined);

  add("keywords-and", "Free text joined with AND",
    "What happens if every keyword must be present rather than any — usually a steep drop, and a precision test.",
    build(p, kwFields, { ...opts, kwOp: "AND" }),
    kw.length < 2 ? "Needs at least two keywords for AND to differ from OR." : undefined);

  return { variants, skipped };
}

/** One term's marginal contribution: the same pool minus that term. */
export interface LeaveOneOutVariant {
  term: string;
  pool: "keywords" | "mesh" | "eric";
  query: string;
  /** True when removing it leaves nothing to run. */
  empty: boolean;
}

/**
 * The query without each term in turn. Compared against the as-built total, the
 * difference is that term's marginal yield: how many records it alone brings in.
 *
 * A term whose removal changes nothing is a candidate for pruning — but only for
 * THIS pool, since terms overlap; dropping two zero-yield terms can still lose
 * records that only they shared.
 */
export function leaveOneOutVariants(
  pool: Pool,
  kwFields: KwFields = {},
  opts: BooleanOpts = {},
  source: Source = "pubmed",
): LeaveOneOutVariant[] {
  const p = withAllPools(pool);
  const targets: Array<{ term: string; pool: "keywords" | "mesh" | "eric" }> = [
    ...(p.keywords ?? []).map(term => ({ term, pool: "keywords" as const })),
    ...(p.mesh ?? []).map(term => ({ term, pool: "mesh" as const })),
    ...(p.eric ?? []).map(term => ({ term, pool: "eric" as const })),
  ];
  return targets.map(t => {
    const without = { ...p, [t.pool]: (p[t.pool] ?? []).filter(x => x !== t.term) };
    const query = buildBooleanQuery(without, kwFields, opts, source);
    return { term: t.term, pool: t.pool, query, empty: !query.trim() };
  });
}

/** Exact overlap between two strings: one count, no sampling. */
export const overlapQuery = (a: string, b: string): string =>
  !a.trim() || !b.trim() ? "" : `(${a.replace(/\n/g, " ").trim()}) AND (${b.replace(/\n/g, " ").trim()})`;
