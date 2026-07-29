// Cross-repo parity for the Search Protocol object: the MCP app's half.
//
// Runs the canonical fixtures (tests/fixtures/protocol-parity.json) through THIS
// repo's buildSearchProtocol. The website runs the same file through its own
// page-global implementation (~/code/pubmedseed/tests/verify-parity.mjs). If the
// two drift, one side goes red.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSearchProtocol } from "../../server/protocol.js";
import { loadProtocolFixtures } from "../helpers/fixtures.js";

const fixtures = loadProtocolFixtures();

test("protocol fixtures are non-empty (guards against a silently truncated file)", () => {
  assert.ok(fixtures.cases.length > 0, "no protocol cases loaded");
});

for (const c of fixtures.cases) {
  test(`protocol parity: ${c.name}`, () => {
    assert.deepStrictEqual(buildSearchProtocol(c.input), c.expected);
  });
}

// Behaviors worth pinning here rather than in the shared fixtures: they assert
// the builder doesn't alias its input, which is an implementation property of
// each repo separately (the website's twin gets the same check in its own suite).
test("does not alias caller state", () => {
  const pool = { keywords: ["a"], mesh: [], eric: [], queries: [], ericQueries: [], ctQueries: [] };
  const searchLog = [{ at: "2026-07-29T00:00:00.000Z", source: "pubmed" as const, query: "a", total: 1 }];
  const termSources = { keywords: { a: { ids: ["1"], from: "seed" as const } } };
  const p = buildSearchProtocol({
    generatedAt: "2026-07-29T00:00:00.000Z",
    tool: { name: "ReviewSeed", version: "test", surface: "mcp-app" },
    source: "pubmed", pool, searchLog, termSources,
  });
  p.terms[0].seeds.push("mutated");
  p.searchLog.push({ at: "x", source: "eric", query: "x", total: 0 });
  p.seedRecords.push("mutated");
  assert.deepStrictEqual(termSources.keywords.a.ids, ["1"], "provenance ids were aliased into the protocol");
  assert.equal(searchLog.length, 1, "caller's search log was aliased into the protocol");
});
