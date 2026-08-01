// Cross-repo parity for the query tuning ladder: the MCP app's half.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildQueryVariants, leaveOneOutVariants, overlapQuery } from "../../server/variants.js";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "variant-parity.json");
const fx = JSON.parse(fs.readFileSync(FIXTURE, "utf-8"));

for (const c of fx.cases) {
  test(`variant parity: ${c.name}`, () => {
    const v = buildQueryVariants(c.pool, c.kwFields, c.opts, c.source);
    assert.deepEqual(v.variants.map(x => ({ key: x.key, query: x.query })), c.expectedVariants);
    // The skip list matters as much as the variants: a rung omitted silently makes
    // an incomplete ladder read as a complete comparison.
    assert.deepEqual(v.skipped.map(x => x.key), c.expectedSkipped.map((x: any) => x.key));
    for (const exp of c.expectedSkipped) {
      const got = v.skipped.find(x => x.key === exp.key)!;
      assert.ok(got.reason.includes(exp.reasonMatches),
        `${exp.key} reason should mention "${exp.reasonMatches}": ${got.reason}`);
    }
  });
}

for (const c of fx.leaveOneOutCases) {
  test(`leave-one-out parity: ${c.name}`, () => {
    assert.deepEqual(leaveOneOutVariants(c.pool, c.kwFields, c.opts, c.source), c.expected);
  });
}

for (const c of fx.overlapCases) {
  test(`overlap query parity: ${c.name}`, () => assert.equal(overlapQuery(c.a, c.b), c.expected));
}

// ── Invariants ───────────────────────────────────────────────────────────────
test("every variant carries a rationale, so a number is never presented bare", () => {
  const v = buildQueryVariants(
    { keywords: ["a", "b"], mesh: ["C"], eric: [], queries: [], ericQueries: [], ctQueries: [] }, {}, {}, "pubmed");
  for (const x of v.variants) {
    assert.ok(x.rationale.length > 25, `${x.key} needs a rationale explaining what it tests`);
    assert.ok(x.label.length > 3, `${x.key} needs a human label`);
  }
});

test("as-built is always the first rung — everything else is measured against it", () => {
  for (const c of fx.cases) {
    const v = buildQueryVariants(c.pool, c.kwFields, c.opts, c.source);
    assert.equal(v.variants[0].key, "as-built");
  }
});

test("no variant is ever identical to the baseline", () => {
  for (const c of fx.cases) {
    const v = buildQueryVariants(c.pool, c.kwFields, c.opts, c.source);
    const baseline = v.variants[0].query;
    for (const x of v.variants.slice(1)) {
      assert.notEqual(x.query, baseline, `${x.key} duplicates the baseline and would measure nothing`);
    }
  }
});

test("every skipped rung explains itself", () => {
  for (const c of fx.cases) {
    for (const s of buildQueryVariants(c.pool, c.kwFields, c.opts, c.source).skipped) {
      assert.ok(s.reason.length > 15, `${s.key} was dropped without a usable reason`);
    }
  }
});

test("variants are built by buildBooleanQuery, not by editing the finished string", () => {
  // A pool whose keyword contains regex-ish and quote-ish characters would break
  // any string-surgery approach; going through the builder makes it a non-issue.
  const v = buildQueryVariants(
    { keywords: ["c-reactive protein (CRP)"], mesh: [], eric: [], queries: [], ericQueries: [], ctQueries: [] },
    {}, {}, "pubmed");
  assert.equal(v.variants[0].query, '"c-reactive protein (CRP)"[tiab]');
  assert.ok(v.variants.some(x => x.query === '"c-reactive protein (CRP)"[all]'));
});
