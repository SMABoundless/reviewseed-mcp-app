// Search Protocol — the serializable record of one search strategy.
//
// SHARED LOGIC. The website has a byte-for-byte behavioral twin of
// buildSearchProtocol() as a page global in index.html, exercised by the
// canonical fixtures in tests/fixtures/protocol-parity.json (this repo runs
// them in tests/unit/protocol.test.ts; the website runs the same file through
// Playwright in tests/verify-parity.mjs). Change behavior here and the fixture
// goes first — see docs/REPORTS-ROADMAP.md in the website repo.
//
// This is the seam every report and exporter reads. Reports must never read
// component state directly: pool + selections + kwFields + framework + filters
// + provenance + log all fold into ONE normalized object here, and renderers
// consume only that.
//
// PURE, and the clock is injected. `generatedAt` is a parameter rather than a
// `new Date()` call inside, because a function that reads the wall clock can't
// be fixture-compared across two repos — and cross-repo comparability is the
// entire reason this file is shaped the way it is.
import { ERIC_THESAURUS_EDITION } from "./eric-thesaurus.js";
import type { KwFields, Pool } from "./query.js";
import type { Source } from "./types.js";

export type PoolKey = keyof Pool;
export type TermKind = "keyword" | "mesh" | "eric" | "query";

// How a term got into the pool. Recorded at add time — unrecoverable later,
// which is why the capture sites matter more than this type does.
// "facet" is website-only today (its ERIC sampled-facet panel can add a
// descriptor straight to the pool); the value lives here so one protocol
// consumer handles both surfaces.
export type TermOrigin = "seed" | "vocab" | "synonym" | "advanced" | "facet" | "manual";

export interface TermProvenance {
  ids: string[];     // record ids (PMID / ERIC accession / NCT id) that contributed the term
  from: TermOrigin;
}

// Sidecar to the pool, deliberately NOT part of it: the query builders keep
// taking string[] and the query-parity fixtures stay untouched.
export type TermSources = Partial<Record<PoolKey, Record<string, TermProvenance>>>;

export interface SearchLogEntry {
  at: string;      // ISO 8601
  source: Source;
  query: string;
  total: number;
}

export interface ProtocolInput {
  generatedAt: string;
  tool: { name: string; version: string; surface: "website" | "mcp-app" };
  source: Source;
  pool: Pool;
  kwFields?: KwFields;
  mode?: "boolean" | "framework";
  query?: string;
  // Omit to mean "everything in the pool is selected" — the MCP app's headless
  // reviewseed_assemble_query has no selection UI, so absent must not read as
  // "nothing selected".
  selected?: Partial<Record<PoolKey, string[]>>;
  booleanOpts?: { kwOp?: string; vocabOp?: string; joinOp?: string };
  framework?: { key: string; buckets: Record<string, string[]> } | null;
  filters?: { summary?: string[] };
  searchLog?: SearchLogEntry[];
  termSources?: TermSources;
}

export interface ProtocolTerm {
  label: string;
  kind: TermKind;
  pool: PoolKey;
  field: string | null;   // keywords only — the PubMed-style field tag
  selected: boolean;
  from: TermOrigin | null;
  seeds: string[];
}

export interface SearchProtocol {
  schema: "reviewseed.search-protocol/1";
  generatedAt: string;
  tool: { name: string; version: string; surface: "website" | "mcp-app" };
  source: { key: Source; label: string; platform: string; api: string };
  query: {
    mode: "boolean" | "framework";
    string: string;
    booleanOpts: { kwOp: string; vocabOp: string; joinOp: string } | null;
    framework: { key: string; buckets: Record<string, string[]> } | null;
  };
  vocabularies: Array<{ key: "mesh" | "eric"; label: string; edition: string | null }>;
  terms: ProtocolTerm[];
  filters: { summary: string[] };
  searchLog: SearchLogEntry[];
  seedRecords: string[];
  counts: {
    keywords: number;
    mesh: number;
    eric: number;
    queries: number;
    terms: number;
    selected: number;
    seedRecords: number;
    searchesRun: number;
    latestTotal: number | null;
  };
}

// PRISMA-S wants the database AND the platform/interface it was searched
// through — "PubMed" alone is an incomplete citation. All three of ours are
// searched via their own public API rather than a vendor platform, which is
// itself the reportable fact.
const SOURCE_META: Record<Source, { label: string; platform: string; api: string }> = {
  pubmed: { label: "PubMed", platform: "NCBI E-utilities (unauthenticated)", api: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils" },
  eric:   { label: "ERIC",   platform: "ERIC public API (api.ies.ed.gov)",   api: "https://api.ies.ed.gov/eric/" },
  trials: { label: "ClinicalTrials.gov", platform: "ClinicalTrials.gov API v2", api: "https://clinicaltrials.gov/api/v2/" },
};

// Pool key -> the term kind reported for it. The three query pools are one
// kind: which source a snippet belongs to is already carried by `pool`.
const KIND_BY_POOL: Record<PoolKey, TermKind> = {
  keywords: "keyword",
  mesh: "mesh",
  eric: "eric",
  queries: "query",
  ericQueries: "query",
  ctQueries: "query",
};

// Fixed emission order. Reports render in this order and the parity fixtures
// compare serialized JSON, so this is load-bearing — don't reorder casually.
const POOL_ORDER: PoolKey[] = ["keywords", "mesh", "eric", "queries", "ericQueries", "ctQueries"];

export function buildSearchProtocol(input: ProtocolInput): SearchProtocol {
  const {
    generatedAt, tool, source, pool,
    kwFields = {}, mode = "boolean", query = "",
    selected, booleanOpts, framework = null,
    filters, searchLog = [], termSources = {},
  } = input;

  const terms: ProtocolTerm[] = [];
  for (const key of POOL_ORDER) {
    const sel = selected?.[key];
    const prov = termSources[key] ?? {};
    for (const label of pool[key] ?? []) {
      terms.push({
        label,
        kind: KIND_BY_POOL[key],
        pool: key,
        field: key === "keywords" ? (kwFields[label] ?? "tiab") : null,
        // No selection map for this pool at all -> everything counts as
        // selected (headless callers); an EMPTY map means genuinely none.
        selected: sel === undefined ? true : sel.includes(label),
        from: prov[label]?.from ?? null,
        seeds: [...(prov[label]?.ids ?? [])],
      });
    }
  }

  // Which controlled vocabularies this strategy actually depends on. ERIC's is
  // a pinned snapshot, so its edition is reportable; MeSH is fetched live from
  // NLM's lookup service, which exposes no edition we can cite.
  const vocabularies: SearchProtocol["vocabularies"] = [];
  if (pool.mesh?.length) vocabularies.push({ key: "mesh", label: "NLM Medical Subject Headings (MeSH)", edition: null });
  if (pool.eric?.length) vocabularies.push({ key: "eric", label: "ERIC Thesaurus", edition: ERIC_THESAURUS_EDITION });

  // Union of every record that contributed a term, in first-seen order.
  const seedRecords: string[] = [];
  for (const key of POOL_ORDER) {
    for (const label of pool[key] ?? []) {
      for (const id of termSources[key]?.[label]?.ids ?? []) {
        if (!seedRecords.includes(id)) seedRecords.push(id);
      }
    }
  }

  const log = searchLog.map(e => ({ at: e.at, source: e.source, query: e.query, total: e.total }));

  return {
    schema: "reviewseed.search-protocol/1",
    generatedAt,
    tool: { name: tool.name, version: tool.version, surface: tool.surface },
    source: { key: source, ...SOURCE_META[source] },
    query: {
      mode,
      string: query,
      booleanOpts: mode === "boolean"
        ? { kwOp: booleanOpts?.kwOp ?? "OR", vocabOp: booleanOpts?.vocabOp ?? "OR", joinOp: booleanOpts?.joinOp ?? "AND" }
        : null,
      framework: mode === "framework" && framework
        ? { key: framework.key, buckets: framework.buckets }
        : null,
    },
    vocabularies,
    terms,
    filters: { summary: [...(filters?.summary ?? [])] },
    searchLog: log,
    seedRecords,
    counts: {
      keywords: pool.keywords?.length ?? 0,
      mesh: pool.mesh?.length ?? 0,
      eric: pool.eric?.length ?? 0,
      queries: (pool.queries?.length ?? 0) + (pool.ericQueries?.length ?? 0) + (pool.ctQueries?.length ?? 0),
      terms: terms.length,
      selected: terms.filter(t => t.selected).length,
      seedRecords: seedRecords.length,
      searchesRun: log.length,
      // The most recent count for THIS source — the number a report cites as
      // "records retrieved". Null when this source was never searched.
      latestTotal: (() => {
        for (let i = log.length - 1; i >= 0; i--) if (log[i].source === source) return log[i].total;
        return null;
      })(),
    },
  };
}
