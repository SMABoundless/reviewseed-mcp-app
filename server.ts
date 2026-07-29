import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { ericThesaurusDetails, ericThesaurusSearch, ERIC_THESAURUS_EDITION } from "./server/eric-thesaurus.js";
import {
  CT_ADV_FIELDS, ctAssembleTerm, ctAuthorSearch, ctLookup, ctSearch,
} from "./server/trials.js";
import {
  ERIC_ADV_FIELDS, ericAssembleTerm, ericAuthorSearch, ericLookup, ericSearch,
} from "./server/eric.js";
import { withMatchedVia } from "./server/match.js";
import { isSlowLookup, meshVocabDetails, meshVocabSearch, SLOW_LOOKUP_NOTICE } from "./server/mesh.js";
import {
  PUBMED_FIELDS, pubmedAssembleTerm, pubmedAuthorSearch, pubmedLookup, pubmedSearch,
} from "./server/pubmed.js";
import { buildBooleanQuery, buildFrameworkQuery, FRAMEWORKS } from "./server/query.js";
import type { Source } from "./server/types.js";

// When compiled, server.js lives inside dist/ alongside mcp-app.html
const DIST_DIR = import.meta.dirname.endsWith("dist")
  ? import.meta.dirname
  : path.join(import.meta.dirname, "dist");
const RESOURCE_URI = "ui://reviewseed/mcp-app.html";
const SOURCES = ["pubmed", "eric", "trials"] as const;
const SOURCE_LABEL: Record<Source, string> = { pubmed: "PubMed", eric: "ERIC", trials: "ClinicalTrials.gov" };

const sourceEnum = z.enum(SOURCES);
const poolSchema = z.object({
  keywords: z.array(z.string()).default([]),
  mesh: z.array(z.string()).default([]),
  eric: z.array(z.string()).default([]),
  queries: z.array(z.string()).default([]),
  ericQueries: z.array(z.string()).default([]),
  ctQueries: z.array(z.string()).default([]),
});
// One shared vocabulary of 4 field tags across all three sources — NOT a
// per-source field list. Each adapter re-translates the same tag into its
// own native syntax: pubmed emits "[tag]"; eric maps ti->title:/ab->description:/
// all->bare/tiab->title+description OR; trials maps ti->AREA[BriefTitle],
// anything else->bare (Essie's default search already spans title+summary+conditions).
const KW_FIELD_TAGS = "tiab (title/abstract), ti (title only), ab (abstract only — no-op for trials), all (no field restriction)";
const kwFieldsSchema = z.record(z.string(), z.string()).default({});

function textResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}
function errorResult(e: unknown) {
  return textResult({ error: e instanceof Error ? e.message : String(e) });
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "ReviewSeed", version: "2.0.0" });

  // ── Trigger tool — Claude calls this to open the UI ──────────────────────────
  registerAppTool(
    server,
    "reviewseed_open",
    {
      title: "Open ReviewSeed",
      description:
        "Opens the ReviewSeed interface for building systematic review and scoping review search strings across " +
        "PubMed, ClinicalTrials.gov, and ERIC. Use when the user wants to search one of these databases, explore " +
        "the MeSH or ERIC Thesaurus vocabulary (synonyms, scope notes, broader/narrower hierarchy), harvest MeSH " +
        "headings/keywords/descriptors from articles, or build a Boolean or framework-structured (PICO, PECO, " +
        "SPIDER, PCC, and 6 others) search string.",
      inputSchema: {
        source: sourceEnum.optional().describe("Pre-select a source (defaults to PubMed) instead of opening blank"),
        query: z.string().optional().describe("Pre-fill and immediately run this search — opens straight to results instead of a blank panel"),
      },
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async ({ source, query }) => ({
      content: [{
        type: "text" as const,
        text: [
          query
            ? `ReviewSeed is open, searching ${SOURCE_LABEL[source ?? "pubmed"]} for "${query}".`
            : "ReviewSeed is open — three sources (PubMed, ClinicalTrials.gov, ERIC), a MeSH/ERIC vocabulary explorer, " +
              "and ten search-strategy frameworks (PICO, PICOS, PECO, SPICE, CIMO, SPIDER, PICo, PCC, ECLIPSE, PIRD) " +
              "plus a Custom builder.",
          "",
          "If the UI did not render inline, call these tools directly instead — no UI required:",
          "  reviewseed_search / reviewseed_lookup / reviewseed_advanced_search — find records (these also render inline as the interactive picker when the UI is available)",
          "  reviewseed_vocab_search / reviewseed_vocab_details — explore MeSH or ERIC Thesaurus terms",
          "  reviewseed_author_search — everything a given author published",
          "  reviewseed_compare_queries — run 2-6 query variants at once and diff counts/unique records",
          "  reviewseed_assemble_query — build a Boolean or framework (PICO/PECO/...) string from a term pool, headlessly",
        ].join("\n"),
      }],
    }),
  );

  // ── Search — shares reviewseed_open's resourceUri (SDK-documented pattern:
  // multiple tools can open/refresh the same app instance). When the UI is
  // available, calling this directly renders the interactive result picker
  // instead of flat JSON; the panel reads this call's own arguments/result
  // via app.ontoolinput/ontoolresult to hydrate itself. Still fully usable
  // headlessly — the JSON below is always returned regardless of rendering. ──
  registerAppTool(
    server,
    "reviewseed_search",
    {
      title: "Search ReviewSeed",
      description: "Search PubMed, ClinicalTrials.gov, or ERIC and return record metadata including MeSH headings/ERIC descriptors and keywords. Renders as an interactive result picker when the UI is available.",
      inputSchema: {
        source: sourceEnum.describe("Which database to search"),
        query: z.string().describe(
          "Search query, in the syntax of the chosen source. Trailing-* truncation (e.g. \"teen*\") is verified to " +
          "expand correctly on PubMed and ERIC (Solr honors it). It does NOT work as truncation on ClinicalTrials.gov " +
          "— Essie's query.term treats \"*\" as a literal character, so a truncated term returns far FEWER matches " +
          "than the bare word (verified: \"diabet*\" → ~76 studies vs. \"diabetes\" → ~35,000). For Trials, search the " +
          "bare term instead of truncating.",
        ),
        page: z.number().int().min(1).max(5).default(1).describe("Page number (1-indexed, max 5)"),
        pageSize: z.number().int().min(1).max(25).default(10).describe("Results per page (ignored for trials, which pages at 10)"),
        matchTerms: z.array(z.string()).optional().describe(
          "Pool terms this query was built from (e.g. the OR'd terms in a Boolean/framework string). When given, " +
          "each result gets a `matchedVia` array — the subset of these terms actually found in that record (MeSH/" +
          "descriptor/keyword exact match, or free-text substring in title/abstract) — instead of leaving you to " +
          "cross-reference the full descriptor list by hand to see why it matched.",
        ),
      },
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async ({ source, query, page, pageSize, matchTerms }) => {
      try {
        const r = source === "eric" ? await ericSearch(query, page, pageSize)
          : source === "trials" ? await ctSearch(query, page)
          : await pubmedSearch(query, page, pageSize);
        return textResult({ ...r, articles: withMatchedVia(r.articles, matchTerms) });
      } catch (e) { return errorResult(e); }
    },
  );

  // ── Lookup (paste citations) — same shared-resourceUri pattern as search ──
  registerAppTool(
    server,
    "reviewseed_lookup",
    {
      title: "Look up ReviewSeed citations",
      description: "Look up records by pasted text containing PMIDs/DOIs (PubMed), EJ/ED accession numbers (ERIC), or NCT ids (ClinicalTrials.gov); title text is a best-effort fallback for all three. Renders as an interactive result picker when the UI is available.",
      inputSchema: {
        source: sourceEnum,
        text: z.string().describe("Pasted reference list"),
      },
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async ({ source, text }) => {
      try {
        const r = source === "eric" ? await ericLookup(text)
          : source === "trials" ? await ctLookup(text)
          : await pubmedLookup(text);
        return textResult(r);
      } catch (e) { return errorResult(e); }
    },
  );

  // ── Advanced search — same shared-resourceUri pattern as search/lookup ────
  registerAppTool(
    server,
    "reviewseed_advanced_search",
    {
      title: "Advanced search ReviewSeed",
      description: "List the field-specific search options for a source, or assemble+run a field-specific query built from multiple rows " +
        "combined with AND/OR/NOT (mirrors each database's own advanced-search builder). Renders as an interactive result picker when the UI is available.",
      inputSchema: {
        source: sourceEnum,
        rows: z.array(z.object({
          field: z.string().describe("Field tag — call with an empty rows array first to see valid tags for this source"),
          value: z.string().describe(
            "Trailing-* truncation works on PubMed/ERIC but not ClinicalTrials.gov (Essie treats \"*\" literally, " +
            "not as a wildcard) — see reviewseed_search's query description for the verified counts.",
          ),
          op: z.enum(["AND", "OR", "NOT"]).optional().describe("Operator joining this row to the previous one; ignored on the first row"),
        })).default([]),
        run: z.boolean().default(true).describe("Also execute the assembled query against the source"),
        page: z.number().int().min(1).max(5).default(1),
      },
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async ({ source, rows, run, page }) => {
      try {
        if (!rows.length) {
          const fields = source === "eric" ? ERIC_ADV_FIELDS : source === "trials" ? CT_ADV_FIELDS : PUBMED_FIELDS;
          return textResult({ fields, message: `Pass rows:[{field,value}] using one of these field tags for ${SOURCE_LABEL[source]}.` });
        }
        const assemble = source === "eric" ? ericAssembleTerm : source === "trials" ? ctAssembleTerm : pubmedAssembleTerm;
        const query = rows.map((r, i) => {
          const snippet = assemble(r.field, r.value);
          return i === 0 ? snippet : `${r.op ?? "AND"} ${snippet}`;
        }).join(" ");
        if (!run) return textResult({ query });
        const results = source === "eric" ? await ericSearch(query, page, 10)
          : source === "trials" ? await ctSearch(query, page)
          : await pubmedSearch(query, page, 10);
        return textResult({ query, ...results });
      } catch (e) { return errorResult(e); }
    },
  );

  // ── Vocabulary explorer ────────────────────────────────────────────────────
  server.tool(
    "reviewseed_vocab_search",
    "Search the MeSH or ERIC Thesaurus controlled vocabulary by heading OR synonym (e.g. \"heart attack\" finds " +
    "Myocardial Infarction). Rows include `via` — the synonym/entry-term that matched, i.e. the print-thesaurus " +
    "cross-reference — when the match wasn't on the canonical label itself.",
    {
      vocab: z.enum(["mesh", "eric"]),
      query: z.string(),
    },
    async ({ vocab, query }) => {
      try {
        if (vocab === "mesh") {
          // A slow NLM lookup is upstream, not a ReviewSeed fault — say so in the
          // result so the answer explains the wait instead of just being late.
          const started = Date.now();
          const rows = await meshVocabSearch(query);
          const slow = isSlowLookup(started, Date.now());
          return textResult(slow ? { rows, slow, notice: SLOW_LOOKUP_NOTICE } : { rows });
        }
        const rows = await ericThesaurusSearch(query);
        return rows === undefined
          ? textResult({ rows: [], error: `Couldn't load the ERIC Thesaurus ${ERIC_THESAURUS_EDITION} snapshot` })
          : textResult({ rows });
      } catch (e) { return errorResult(e); }
    },
  );

  server.tool(
    "reviewseed_vocab_details",
    "Get the scope note (MeSH only), entry terms / Use-For synonyms, and broader/narrower headings for a MeSH or " +
    "ERIC Thesaurus term. Broader/narrower terms can be passed back into reviewseed_vocab_search to walk the hierarchy.",
    {
      vocab: z.enum(["mesh", "eric"]),
      label: z.string().describe("The canonical heading/descriptor label (not a synonym)"),
      id: z.string().optional().describe("MeSH descriptor id, if known from a prior vocab_search result — enables the scope note"),
    },
    async ({ vocab, label, id }) => {
      try {
        if (vocab === "mesh") {
          const started = Date.now();
          const details = await meshVocabDetails(label, id);
          const slow = isSlowLookup(started, Date.now());
          return textResult(slow ? { ...details, slow, notice: SLOW_LOOKUP_NOTICE } : details);
        }
        const details = await ericThesaurusDetails(label);
        return details === undefined
          ? textResult({ terms: [], bt: [], nt: [], scopeNote: "", error: `Couldn't load the ERIC Thesaurus ${ERIC_THESAURUS_EDITION} snapshot` })
          : textResult(details);
      } catch (e) { return errorResult(e); }
    },
  );

  // ── Author lookup ──────────────────────────────────────────────────────────
  server.tool(
    "reviewseed_author_search",
    "Find everything a given author has published in the chosen source.",
    {
      source: sourceEnum,
      name: z.string(),
      page: z.number().int().min(1).max(5).default(1),
    },
    async ({ source, name, page }) => {
      try {
        const r = source === "eric" ? await ericAuthorSearch(name, page, 10)
          : source === "trials" ? await ctAuthorSearch(name)
          : await pubmedAuthorSearch(name, page, 10);
        return textResult(r);
      } catch (e) { return errorResult(e); }
    },
  );

  // ── Compare query variants ─────────────────────────────────────────────────
  server.tool(
    "reviewseed_compare_queries",
    "Run 2-6 query variants against the same source in one call — for tuning a tight-vs-broad search string, or " +
    "checking whether adding a term meaningfully changes a result set. Returns each variant's real total count " +
    "(from the source's own count, not sampled) plus which ids in a top-ranked sample are unique to that variant. " +
    "The uniqueness comparison is a SAMPLE of top matches, not a full-corpus diff — two variants with identical " +
    "totals can still sample as 100% unique to each other if they're retrieving different (equally-sized) result " +
    "sets. ClinicalTrials.gov always samples exactly 10 per variant (its API's fixed page size); PubMed/ERIC honor " +
    "sampleSize up to 50.",
    {
      source: sourceEnum,
      queries: z.array(z.object({
        label: z.string().describe('Short name for this variant, e.g. "tight" or "broad"'),
        query: z.string(),
      })).min(2).max(6),
      sampleSize: z.number().int().min(5).max(50).default(20).describe("Top-ranked ids per variant to sample for uniqueness (ignored for trials, fixed at 10)"),
    },
    async ({ source, queries, sampleSize }) => {
      // Sequential, not concurrent: firing 2-6 esearch+efetch pipelines at
      // once against NCBI (whose unauthenticated cap is a tight 3 req/sec)
      // measurably increases 429s beyond what a solo reviewseed_search call
      // sees, since overlapping in-flight requests aren't fully avoided by
      // request-start pacing alone — confirmed live: a concurrent pair failed
      // where the same two queries run one after another mostly didn't. Each
      // variant still gets its own try/catch so one transient failure can't
      // blank out the others.
      const results: Array<{ label: string; query: string; total: number; error?: string; ids: string[] }> = [];
      for (const q of queries) {
        try {
          const r = source === "eric" ? await ericSearch(q.query, 1, sampleSize)
            : source === "trials" ? await ctSearch(q.query, 1)
            : await pubmedSearch(q.query, 1, sampleSize);
          results.push({ label: q.label, query: q.query, total: r.total, error: r.error, ids: r.articles.map(a => a.pmid) });
        } catch (e) {
          results.push({ label: q.label, query: q.query, total: 0, error: e instanceof Error ? e.message : String(e), ids: [] });
        }
      }
      const idSets = results.map(r => new Set(r.ids));
      const comparison = results.map((r, i) => ({
        label: r.label,
        query: r.query,
        total: r.total,
        error: r.error,
        sampled: r.ids.length,
        uniqueToThisVariant: r.ids.filter(id => !idSets.some((s, j) => j !== i && s.has(id))),
      }));
      return textResult({ comparison });
    },
  );

  // ── Query assembly — the one tool useful even with the UI never opened ────
  server.tool(
    "reviewseed_assemble_query",
    "Assemble a Boolean or framework-structured (PICO, PECO, SPIDER, PCC, ...) search string from a curated term " +
    "pool, in the target source's own syntax (PubMed bracket tags, ERIC field prefixes, or ClinicalTrials.gov " +
    "AREA[...] operators). Call with mode \"framework\" and no `framework.key` to list the ten available frameworks. " +
    "Callable directly without ever opening the UI.",
    {
      source: sourceEnum,
      pool: poolSchema,
      kwFields: kwFieldsSchema.describe(
        `Per-keyword field tag; defaults to tiab. Same 4 tags for every source — ${KW_FIELD_TAGS} — ` +
        "each source re-translates them into its own native syntax (PubMed bracket tags, ERIC field prefixes, or ClinicalTrials.gov AREA[...] operators). Not ERIC's or Trials' own field names.",
      ),
      mode: z.enum(["boolean", "framework"]).default("boolean"),
      booleanOpts: z.object({
        kwOp: z.enum(["OR", "AND"]).default("OR"),
        vocabOp: z.enum(["OR", "AND"]).default("OR"),
        joinOp: z.enum(["AND", "OR"]).default("AND"),
      }).default({}),
      framework: z.object({
        key: z.string().describe("One of the FRAMEWORKS keys, e.g. PICO, PECO, SPIDER, PCC, Custom"),
        buckets: z.record(z.string(), z.array(z.string())).describe("Bucket key -> term labels placed in that bucket"),
      }).optional(),
    },
    async ({ source, pool, kwFields, mode, booleanOpts, framework }) => {
      try {
        if (mode === "framework" && !framework?.key) {
          return textResult({
            frameworks: Object.fromEntries(Object.entries(FRAMEWORKS).map(([k, f]) => [k, { full: f.full, tag: f.tag, blurb: f.blurb, buckets: f.buckets }])),
          });
        }
        const query = mode === "framework"
          ? buildFrameworkQuery(framework!.key, framework!.buckets, pool, kwFields, source)
          : buildBooleanQuery(pool, kwFields, booleanOpts, source);
        return textResult({ query });
      } catch (e) { return errorResult(e); }
    },
  );

  // ── UI resource — serves the bundled HTML to the host ─────────────────────────
  registerAppResource(
    server,
    RESOURCE_URI,
    RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      const html = await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");
      return {
        contents: [{
          uri: RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: html,
          _meta: {
            ui: {
              csp: {
                // Google Fonts (Fraunces/Inter/JetBrains Mono) — same origins the website allow-lists.
                resourceDomains: ["https://fonts.googleapis.com", "https://fonts.gstatic.com"],
              },
              // Without this, navigator.clipboard.writeText() silently no-ops in the sandboxed iframe.
              permissions: { clipboardWrite: {} },
            },
          },
        }],
      };
    },
  );

  return server;
}
