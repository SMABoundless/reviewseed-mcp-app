# ReviewSeed MCP App — test suites

```bash
npm test              # fast, offline, deterministic — run this constantly
npm run test:live     # hits the real APIs — run before releases / when upstream may have changed
```

`npm test` typechecks, then runs the unit + integration suites (~1.5s, no network).

## Layout

| Path | What it covers | Network |
|---|---|---|
| `unit/query-internals.test.ts` | Query-builder edge cases local to this repo; framework config invariants | none |
| `unit/parity.test.ts` | **Cross-repo parity** — canonical fixtures vs. this repo's builders | none |
| `unit/match.test.ts` | `matchedVia` word-boundary matching, regex escaping, immutability | none |
| `unit/eric-thesaurus.test.ts` | Shipped ERIC Thesaurus snapshot: synonym search, ranking, hierarchy | none (local asset) |
| `integration/tools.test.ts` | Real MCP client ↔ server over `InMemoryTransport`, all HTTP stubbed | stubbed |
| `live/smoke.test.ts` | Upstream API contracts still match what the adapters parse | **real** |

## Cross-repo parity (the important one)

`fixtures/query-parity.json` is the **single source of truth** for shared query-assembly
behavior across both ReviewSeed codebases:

- **This repo** runs it against `server/query.ts` (`unit/parity.test.ts`)
- **The website** runs the same file against `index.html`'s page-global builders
  (`~/code/pubmedseed/tests/verify-parity.mjs`, via Playwright `page.evaluate`)

Much of this repo's server code was originally ported verbatim from the website, so the
two drift easily — every bug in the 2026-07-26 QA cycle existed in both. These fixtures
turn drift into a red test instead of a discovery months later.

The fixtures are **not duplicated** into the website repo on purpose: a stale copy would
pass green while being out of sync. The website reads this file directly, and **skips
loudly** (never silently passes) if this repo isn't checked out. Point it elsewhere with
`REVIEWSEED_MCP_APP=/path/to/reviewseed-mcp-app`.

**When changing shared query behavior: add the case to the fixtures first, then make both
repos pass it.** If a case is genuinely MCP-app-specific, put it in `unit/query-internals.test.ts`
instead so the website isn't held to it.

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
