// Emit-only database translations.
//
// SHARED LOGIC. The website has a behavioral twin (index.html page globals
// PLATFORMS / platformTerm / buildPlatformQuery), and both run the canonical
// fixtures in tests/fixtures/translation-parity.json. Change behavior in the
// fixture FIRST. See docs/REPORTS-ROADMAP.md §3.4 in the website repo.
//
// EMIT-ONLY, and that word is load-bearing. ReviewSeed cannot query Ovid,
// Embase.com, Scopus, Web of Science, EBSCO, ProQuest or the Cochrane Library —
// no public API, no key, no CORS. These strings are produced for a human to
// paste into that platform's own search box, and NOTHING here has been executed
// against the live platform. Every consumer must carry that caveat: a string
// that looks authoritative and silently fails is worse than no string.
//
// The four field tags are the same ones the rest of ReviewSeed uses — tiab, ti,
// ab, all — and each platform re-expresses them in its own syntax.
import type { KwFields, Pool } from "./query.js";

export type PlatformKey = "ovid" | "embase" | "scopus" | "wos" | "ebsco" | "proquest" | "cochrane";

export interface Platform {
  key: PlatformKey;
  label: string;          // how librarians name it
  vendor: string;         // the interface the syntax belongs to
  vocabulary: string;     // the controlled vocabulary this syntax addresses, or "" when it has none
  /** Keyword term in this platform's syntax, for one of the four field tags. */
  kw(term: string, tag: string): string;
  /** Controlled-vocabulary heading, exploded where the platform supports it. */
  vocab(term: string): string;
  /** How a bare vocabulary term is handled when the platform has no thesaurus. */
  note: string;
}

// Quoting differs by vendor and this is the most common source of a broken
// paste, so it's centralized rather than inlined per platform.
const dq = (t: string) => `"${t}"`;                       // double quotes: most vendors
const sq = (t: string) => `'${t.replace(/'/g, "''")}'`;   // Embase.com; doubled to escape

export const PLATFORMS: Platform[] = [
  {
    key: "ovid",
    label: "Ovid (MEDLINE / Embase)",
    vendor: "Ovid",
    vocabulary: "MeSH / Emtree",
    // Ovid puts the field code AFTER the term, delimited by periods: .ti,ab.
    // Subject headings end in "/" and "exp" explodes them.
    kw: (t, tag) => `${dq(t)}${tag === "ti" ? ".ti." : tag === "ab" ? ".ab." : tag === "all" ? ".mp." : ".ti,ab."}`,
    vocab: t => `exp ${t}/`,
    note: "`.mp.` is Ovid's multi-purpose field, the closest equivalent to All Fields; `exp` explodes the heading.",
  },
  {
    key: "embase",
    label: "Embase.com",
    vendor: "Elsevier",
    vocabulary: "Emtree",
    kw: (t, tag) => `${sq(t)}:${tag === "ti" ? "ti" : tag === "ab" ? "ab" : tag === "all" ? "ab,ti,kw,de" : "ti,ab"}`,
    vocab: t => `${sq(t)}/exp`,
    note: "Embase.com requires single quotes. Emtree headings differ from MeSH — verify each heading exists in Emtree.",
  },
  {
    key: "scopus",
    label: "Scopus",
    vendor: "Elsevier",
    vocabulary: "",
    kw: (t, tag) => `${tag === "ti" ? "TITLE" : tag === "ab" ? "ABS" : tag === "all" ? "ALL" : "TITLE-ABS"}(${dq(t)})`,
    vocab: t => `INDEXTERMS(${dq(t)})`,
    note: "Scopus has no thesaurus of its own; headings are emitted as INDEXTERMS, which matches indexing supplied by the source database and will not explode.",
  },
  {
    key: "wos",
    label: "Web of Science",
    vendor: "Clarivate",
    vocabulary: "",
    kw: (t, tag) => `${tag === "ti" ? "TI" : tag === "ab" ? "AB" : tag === "all" ? "ALL" : "TS"}=(${dq(t)})`,
    vocab: t => `TS=(${dq(t)})`,
    note: "Web of Science has no subject headings. Headings become topic (TS) phrases, so recall depends on the words appearing in the record.",
  },
  {
    key: "ebsco",
    label: "EBSCO (CINAHL / PsycINFO)",
    vendor: "EBSCO",
    vocabulary: "CINAHL Subject Headings / APA Thesaurus",
    kw: (t, tag) => tag === "ti" ? `TI ${dq(t)}`
      : tag === "ab" ? `AB ${dq(t)}`
      : tag === "all" ? `TX ${dq(t)}`
      : `(TI ${dq(t)} OR AB ${dq(t)})`,
    // "+" explodes in CINAHL. PsycINFO uses DE and does not take "+".
    vocab: t => `(MH ${dq(t + "+")})`,
    note: "MH with a trailing + explodes a CINAHL heading. For PsycINFO swap MH for DE and drop the +; the two thesauri do not share term forms.",
  },
  {
    key: "proquest",
    label: "ProQuest",
    vendor: "ProQuest",
    vocabulary: "database-specific",
    kw: (t, tag) => tag === "ti" ? `ti(${dq(t)})`
      : tag === "ab" ? `ab(${dq(t)})`
      : tag === "all" ? `all(${dq(t)})`
      : `(ti(${dq(t)}) OR ab(${dq(t)}))`,
    vocab: t => `su(${dq(t)})`,
    note: "`su()` searches whichever subject vocabulary the selected ProQuest database uses, which varies by database.",
  },
  {
    key: "cochrane",
    label: "Cochrane Library (CENTRAL)",
    vendor: "Wiley",
    vocabulary: "MeSH",
    kw: (t, tag) => `${dq(t)}:${tag === "ti" ? "ti" : tag === "ab" ? "ab" : tag === "all" ? "ti,ab,kw" : "ti,ab"}`,
    vocab: t => `[mh ${dq(t)}]`,
    note: "`[mh \"...\"]` explodes by default; prefix the heading with ^ to search it unexploded. CENTRAL indexing is thinner than MEDLINE's, so keywords carry more weight here.",
  },
];

export const PLATFORM_CAVEAT =
  "Emit-only: ReviewSeed cannot run these platforms, so these strings are UNTESTED. " +
  "Paste into the platform's own search box and verify the result count before relying on it.";

const byKey = new Map(PLATFORMS.map(p => [p.key, p]));
export const getPlatform = (key: string): Platform | undefined => byKey.get(key as PlatformKey);

/** One pooled term in one platform's syntax. `kind` decides which emitter runs. */
export function platformTerm(key: PlatformKey, kind: "keyword" | "vocab", term: string, tag = "tiab"): string {
  const p = byKey.get(key);
  if (!p) return term;
  return kind === "vocab" ? p.vocab(term) : p.kw(term, tag);
}

/**
 * Whole-pool query for one platform: keywords OR'd, vocabulary OR'd, the two
 * groups AND'd — the same shape buildBooleanQuery produces for the native
 * sources, so a translation is recognizably the same search.
 *
 * Pooled advanced-search snippets are deliberately NOT translated: they are
 * already in a specific source's syntax (PubMed brackets, Essie AREA[...]),
 * and machine-rewriting one vendor's syntax into another is exactly the kind of
 * plausible-but-wrong output this module refuses to produce. Callers should
 * surface the omission rather than hide it — see `untranslated`.
 */
export function buildPlatformQuery(key: PlatformKey, pool: Pool, kwFields: KwFields = {}): string {
  const p = byKey.get(key);
  if (!p) return "";
  const groups: string[] = [];
  const kws = (pool.keywords ?? []).map(t => p.kw(t, kwFields[t] ?? "tiab"));
  // MeSH and ERIC pools both hold controlled-vocabulary headings; a translation
  // target has one thesaurus slot, so they merge here.
  const vocab = [...(pool.mesh ?? []), ...(pool.eric ?? [])].map(t => p.vocab(t));
  if (kws.length) groups.push(kws.length > 1 ? `(${kws.join(" OR ")})` : kws[0]);
  if (vocab.length) groups.push(vocab.length > 1 ? `(${vocab.join(" OR ")})` : vocab[0]);
  return groups.join(" AND ");
}

/** Pooled snippets that were left out of every translation, so callers can say so. */
export function untranslated(pool: Pool): string[] {
  return [...(pool.queries ?? []), ...(pool.ericQueries ?? []), ...(pool.ctQueries ?? [])];
}

/** The full matrix: every platform's string for one pool. */
export function buildTranslationMatrix(pool: Pool, kwFields: KwFields = {}) {
  return {
    caveat: PLATFORM_CAVEAT,
    untranslated: untranslated(pool),
    platforms: PLATFORMS.map(p => ({
      key: p.key,
      label: p.label,
      vendor: p.vendor,
      vocabulary: p.vocabulary,
      note: p.note,
      query: buildPlatformQuery(p.key, pool, kwFields),
    })),
  };
}
