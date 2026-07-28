# ReviewSeed MCP App — test suites

```bash
npm test              # fast, offline, deterministic — run this constantly
npm run test:live     # hits the real APIs — run before releases / when upstream may have changed
npm run snapshot      # regenerate the generated fixtures after changing shared config/parsers
```

`npm test` typechecks, then runs the unit + integration suites (113 tests, ~1.7s, no network).

## Layout

| Path | What it covers | Network |
|---|---|---|
| `unit/query-internals.test.ts` | Query-builder edge cases local to this repo; framework config invariants | none |
| `unit/parity.test.ts` | **Cross-repo** — query assembly (Boolean + framework) | none |
| `unit/formatter-parity.test.ts` | **Cross-repo** — per-source term formatters | none |
| `unit/shared-surface.test.ts` | **Cross-repo** — field lists + framework config snapshot | none |
| `unit/parser-parity.test.ts` | **Cross-repo** — upstream-response parsers | none |
| `unit/match.test.ts` | `matchedVia` word-boundary matching, regex escaping, immutability | none |
| `unit/eric-thesaurus.test.ts` | Shipped ERIC Thesaurus snapshot: synonym search, ranking, hierarchy | none (local asset) |
| `integration/tools.test.ts` | Real MCP client ↔ server over `InMemoryTransport`, all HTTP stubbed | stubbed |
| `live/smoke.test.ts` | Upstream API contracts still match what the adapters parse | **real** |

## Cross-repo parity (the important part)

Much of this repo's server code was originally ported verbatim from the website, so the
two drift easily — every bug in the 2026-07-26 QA cycle existed in both, and building
these checks immediately surfaced two more (a missing PubMed field here, and divergent
MeSH/keyword handling there).

**This repo owns the canonical fixtures.** The website reads them directly and **skips
loudly** (never silently passes) if this repo isn't checked out — they're deliberately not
duplicated, since a stale copy would pass green while out of sync. Point elsewhere with
`REVIEWSEED_MCP_APP=/path/to/reviewseed-mcp-app`.

Three different shapes, because different kinds of shared surface need different tests:

| Fixture | Shape | Why |
|---|---|---|
| `query-parity.json` | input → expected string | **Behavior.** Pin the expected output independently of both implementations. |
| `formatter-parity.json` | input → expected string | Same, for the leaf term formatters (`ericKwTerm`, `ctMeshTerm`, `*AssembleTerm`…). |
| `shared-surface.json` | **generated** snapshot | **Data** (field lists, framework config). Compared directly — no hand-maintained third copy, so adding a field to one repo and not the other fails immediately. |
| `parser-inputs.json` + `parser-expected.json` | canned upstream bytes → expected `Article` | **Parsers.** Feeding byte-identical payloads to both is the only way to separate real divergence from an upstream difference. |

The last two are **generated** by `npm run snapshot`. Their guard tests fail with "stale"
if the code changes without regenerating — that failure, plus the website's matching
failure, is the drift signal.

**Workflow when changing shared behavior:** add/update the fixture case first, run
`npm run snapshot` if it's a generated one, then make both repos pass. Behavior genuinely
unique to this app belongs in `unit/query-internals.test.ts` instead, so the website isn't
held to it.

### Known, accepted divergences

- This app's PubMed articles set `src`, `eric` and `url`; the website's omit them (PubMed
  is its implicit default and its render layer compensates). The parser parity check
  compares the fields carrying parsed content and *reports* the shape difference.
- Not parity-checked on purpose: `pubmedSearch`'s orchestration. The website's takes
  `sort`/`dateFilter` and does reverse-pagination; this app's doesn't. The shared part is
  `efetchXml`'s parsing, not the flow around it.

## Why integration tests run in-process

`helpers/harness.ts` wires a real `Client` to `createServer()` over `InMemoryTransport`
rather than spawning `dist/main.js --stdio`. That means: no build step needed, no child
process to leak, and — critically — `globalThis.fetch` stubs installed by a test actually
apply to the server's adapters.

That last point is what makes the 429 regressions testable at all. `helpers/mock-fetch.ts`
can return a 429 on demand, so the suite can assert that a rate-limited `efetch` reports
`efetch HTTP 429` (not the old cryptic `missing root element`) and that the single retry
fires. Neither is reliably reproducible against live NCBI.

Tests set `REVIEWSEED_RATE_LIMIT_MS=0` so the adapters' ~350ms pacing doesn't add real
seconds to an offline run.

## Mocked vs. live — why both

Mocked tests can't catch **upstream drift**, and this project has already been burned by it:
ERIC moved from `api.eric.ed.gov` to `api.ies.ed.gov` with a breaking schema change
(`descriptor` → `subject`). `live/smoke.test.ts` asserts loosely on shape and plausibility,
not exact counts. An occasional red run there may just be a 429; a persistent one means an
API changed.

It also pins the verified truncation asymmetry (PubMed/ERIC expand a trailing `*`,
ClinicalTrials.gov treats it literally) — if that ever flips, `reviewseed_search`'s tool
description needs updating.

## Known gap

No UI tests. `src/mcp-app.tsx` needs a host bridge to function — `callServerTool` and
`openLink` go over postMessage to a host that doesn't exist in a bare browser, so testing it
means building a fake host harness. Deferred deliberately: high cost, and it's the layer
*least* shared with the website. The logic the UI depends on (`server/query.ts`) is fully
covered above.
