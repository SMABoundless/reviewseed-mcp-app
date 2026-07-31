// Cross-repo parity: the MCP app's half.
//
// Runs the canonical fixtures (tests/fixtures/query-parity.json) through THIS
// repo's query builders. The ReviewSeed website runs the exact same fixtures
// through its own implementation (~/code/pubmedseed/tests/verify-parity.mjs).
// If the two ever drift, one side goes red.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBooleanQuery, buildFrameworkQuery, idClause, restrictToIds } from "../../server/query.js";
import { loadParityFixtures } from "../helpers/fixtures.js";

const fixtures = loadParityFixtures();

test("parity fixtures are non-empty (guards against a silently truncated file)", () => {
  assert.ok(fixtures.boolean.length > 0, "no boolean cases loaded");
  assert.ok(fixtures.framework.length > 0, "no framework cases loaded");
});

for (const c of fixtures.boolean) {
  test(`boolean parity: ${c.name}`, () => {
    assert.equal(buildBooleanQuery(c.pool, c.kwFields, c.opts, c.target), c.expected);
  });
}

for (const c of fixtures.framework) {
  test(`framework parity: ${c.name}`, () => {
    assert.equal(buildFrameworkQuery(c.frameworkKey, c.buckets, c.pool, c.kwFields, c.target), c.expected);
  });
}

// ── Recall-validation id clauses ────────────────────────────────────────────
for (const c of (fixtures as any).idClauseCases ?? []) {
  test(`id clause parity: ${c.name}`, () => {
    assert.equal(idClause(c.source, c.ids), c.expectedClause);
    assert.equal(restrictToIds(c.source, c.query, c.ids), c.expectedRestricted);
  });
}

test("id-clause fixtures cover all three sources", () => {
  const sources = new Set(((fixtures as any).idClauseCases ?? []).map((c: any) => c.source));
  assert.deepEqual([...sources].sort(), ["eric", "pubmed", "trials"]);
});
