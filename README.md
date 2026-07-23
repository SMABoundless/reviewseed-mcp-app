# ReviewSeed MCP App

An MCP App that renders the full [ReviewSeed](https://reviewseed.library.northwestern.edu) interface inline inside a compatible host (such as Claude). Helps researchers build systematic review and scoping review search strings across **PubMed, ClinicalTrials.gov, and ERIC** — searching each source, exploring the MeSH/ERIC Thesaurus vocabulary (synonyms, scope notes, broader/narrower hierarchy), harvesting terms from records, and assembling a Boolean or ten-framework (PICO, PECO, SPIDER, PCC, and six others) search string.

Built with the [MCP Apps framework](https://apps.extensions.modelcontextprotocol.io/api/) (`@modelcontextprotocol/ext-apps`). Sibling to the [ReviewSeed website](https://github.com/nulib-ds/reviewseed) — this app mirrors the same three-source, vocabulary-explorer, ten-framework functionality as an MCP surface, plus tools (`reviewseed_vocab_search`, `reviewseed_assemble_query`) that are useful even when Claude never opens the UI.

---

## What it does

When Claude calls the `reviewseed_open` tool, the host renders the ReviewSeed UI inline:

1. **Search** PubMed, ClinicalTrials.gov, or ERIC — or **paste a reference list** (PMIDs/DOIs, EJ/ED numbers, NCT ids), or build a **field-specific Advanced Search**
2. **Explore the vocabulary** directly — search MeSH or the ERIC Thesaurus by heading OR synonym, expand a row for its scope note, entry terms, and broader/narrower hierarchy
3. **Harvest** MeSH headings, ERIC descriptors, and author keywords from selected records
4. **Build a search string** with the Boolean Builder or one of ten frameworks (PICO, PICOS, PECO, SPICE, CIMO, SPIDER, PICo, PCC, ECLIPSE, PIRD) or a Custom builder
5. **Copy or run** the finished string directly in the source database

Every tool works standalone too — Claude can look up vocabulary or assemble a query string without ever opening the UI (see `reviewseed_vocab_search` / `reviewseed_assemble_query` below).

---

## Architecture

```
Claude / Host
    │
    ├─ calls reviewseed_open
    │       └─ host fetches ui://reviewseed/mcp-app.html
    │               └─ renders ReviewSeed React UI (iframe)
    │
    └─ UI calls (via app bridge) — or Claude calls these directly, no UI required:
            ├─ reviewseed_search            → esearch/efetch (PubMed) · Solr (ERIC) · v2 API (Trials)
            ├─ reviewseed_lookup             → resolve pasted PMIDs/DOIs/EJ-ED/NCT/titles
            ├─ reviewseed_advanced_search    → field-specific query builder + optional run
            ├─ reviewseed_vocab_search       → MeSH (NLM SPARQL) / ERIC Thesaurus synonym search
            ├─ reviewseed_vocab_details      → scope note, entry terms, broader/narrower
            ├─ reviewseed_author_search      → everything an author published, per source
            └─ reviewseed_assemble_query     → Boolean or 10-framework string, in the target's syntax
```

**Tools exposed:**

| Tool | Typically called by | Description |
|---|---|---|
| `reviewseed_open` | Claude | Opens the UI in the host |
| `reviewseed_search` | UI or Claude | Search PubMed / ERIC / ClinicalTrials.gov |
| `reviewseed_lookup` | UI or Claude | Resolve pasted citations to records |
| `reviewseed_advanced_search` | UI or Claude | List field options, or assemble + run a multi-row field query |
| `reviewseed_vocab_search` | UI or Claude | Search MeSH / ERIC Thesaurus by heading or synonym |
| `reviewseed_vocab_details` | UI or Claude | Scope note, entry terms, broader/narrower for a heading |
| `reviewseed_author_search` | UI or Claude | Everything an author published in the chosen source |
| `reviewseed_assemble_query` | UI or Claude | Build a Boolean or framework string from a term pool — headless-friendly |

### Source layout

```
server/
  types.ts            unified Article/Pool/VocabRow types across all 3 sources
  rate-limit.ts        shared ~2.85 req/sec limiter factory (one instance per upstream API)
  pubmed.ts            E-utilities: esearch/efetch, PUBMED_FIELDS, lookup, author search
  mesh.ts               NLM SPARQL: vocab search, scope note, entry terms, hierarchy
  eric.ts               ERIC Solr API: search, lookup, ERIC_ADV_FIELDS, term formatting
  eric-thesaurus.ts    ships the annual Use-For/broader/narrower snapshot (see assets/) — ERIC's
                        API has no thesaurus endpoint, so this is a same-origin static asset
  trials.ts             ClinicalTrials.gov v2 API: search (token-paged), lookup, CT_ADV_FIELDS
  query.ts              FRAMEWORKS (all 10 + Custom) + buildBooleanQuery/buildFrameworkQuery —
                        pure, shared between the server tool and the browser UI's live preview
server.ts               registers all 8 tools + the UI resource
main.ts                 HTTP (Express) / stdio entry point + REST fallback (/api/search, /api/lookup, /api/vocab)
src/mcp-app.tsx          the React UI (source switcher, 4 input modes, vocab explorer, both builders)
```

**Deliberately deferred** (present on the website, not yet in this app): the sampled-facets system —
draggable year histogram, rate-limited background enrichment, ERIC's full 9-group facet rebuild, and
PubMed's Filters checkboxes (article type / species / sex / age / language). It's a large,
performance-tuned, highly source-specific subsystem; `reviewseed_advanced_search` covers the same
ground for tool-driven use (e.g. `pt` / `publicationtype` / `Phase` field rows) without the UI.

---

## Development

### Prerequisites

- Node.js 18+
- npm

### Install

```bash
cd reviewseed-mcp-app
npm install
```

### Dev mode (watch + rebuild)

```bash
npm start
```

This runs Vite in watch mode (rebuilds the UI on changes) and starts the MCP server with `tsx watch`.

### Production build

```bash
npm run build
```

Outputs:
- `dist/mcp-app.html` — bundled single-file React UI (served as the `ui://` resource)
- `dist/main.js` / `dist/server.js` / `dist/server/*.js` — compiled MCP server
- `dist/server/assets/eric-thesaurus-2025.json` — the shipped ERIC Thesaurus snapshot

### Start server (after build)

```bash
# HTTP transport (for remote/hosted use)
node dist/main.js

# stdio transport (for local Claude Desktop use)
node dist/main.js --stdio
```

HTTP server listens on `http://localhost:3001/mcp` by default. Override with the `PORT` environment variable.

---

## Connecting to Claude Desktop

### HTTP transport (local)

Run `node dist/main.js` then add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "reviewseed": {
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

### stdio transport (local, no server process)

```json
{
  "mcpServers": {
    "reviewseed": {
      "command": "node",
      "args": ["/absolute/path/to/reviewseed-mcp-app/dist/main.js", "--stdio"]
    }
  }
}
```

### Claude Code CLI

```bash
claude mcp add reviewseed --transport http http://localhost:3001/mcp
```

---

## Publishing to the MCP Registry

To list this server in the [MCP Registry](https://registry.modelcontextprotocol.io):

1. Deploy the server to a hosting provider (Railway, Fly.io, Render, etc.)
2. Install the registry publisher CLI: `make publisher` (see [registry repo](https://github.com/modelcontextprotocol/registry))
3. Run `./bin/mcp-publisher` and authenticate via GitHub OAuth or DNS verification
4. Provide your server's public URL (`https://your-app.example.com/mcp`)

---

## APIs

All public, no API key required for standard use:

- [NCBI E-utilities](https://www.ncbi.nlm.nih.gov/books/NBK25500/) — PubMed. Unauthenticated rate limit 3 req/sec.
- [NLM MeSH Lookup / SPARQL](https://id.nlm.nih.gov/mesh/) — vocabulary explorer.
- [ERIC](https://eric.ed.gov/?api) (`api.ies.ed.gov/eric/`) — no sort, no DOI field, no author-keyword field.
- [ClinicalTrials.gov v2](https://clinicaltrials.gov/data-api/api) — Essie `AREA[...]` query syntax, token-based paging.

To add an NCBI API key, set `NCBI_API_KEY` and pass it through in `server/pubmed.ts`'s `NCBI_TOOL_PARAMS`.

---

## License

MIT
