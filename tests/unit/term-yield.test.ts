// Cross-repo parity for the term-yield analysis: the MCP app's half.
//
// Pure computation over a SearchProtocol, so the fixtures are exact objects.
// The website runs the same file through its page-global twin.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTermYield } from "../../server/protocol.js";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "term-yield-parity.json");
const fx = JSON.parse(fs.readFileSync(FIXTURE, "utf-8"));

test("term-yield fixtures are non-empty (guards against a silently truncated file)", () => {
  assert.ok(fx.cases.length > 0);
});

for (const c of fx.cases) {
  test(`term yield parity: ${c.name}`, () => {
    assert.deepStrictEqual(buildTermYield(c.protocol), c.expected);
  });
}

// ── Invariants that keep the analysis honest ─────────────────────────────────
test("a term with no seed records is 'uncorroborated', never counted as fragile", () => {
  const y = buildTermYield(fx.cases[0].protocol);
  for (const label of y.uncorroborated) {
    assert.ok(!y.fragile.includes(label), `${label} cannot be both fragile and uncorroborated`);
  }
});

test("every seed in the protocol appears, including one that contributed nothing", () => {
  const c = fx.cases[0];
  const y = buildTermYield(c.protocol);
  assert.deepEqual(y.seeds.map(s => s.id).sort(), [...c.protocol.seedRecords].sort());
  assert.ok(y.barrenSeeds.length > 0, "the fixture is meant to include a barren seed");
});

test("ordering is stable: seed count descending, then label ascending", () => {
  const y = buildTermYield(fx.cases[0].protocol);
  for (let i = 1; i < y.terms.length; i++) {
    const a = y.terms[i - 1], b = y.terms[i];
    assert.ok(a.seedCount > b.seedCount || (a.seedCount === b.seedCount && a.label.localeCompare(b.label) <= 0),
      `${a.label} should not precede ${b.label}`);
  }
});

test("the balance note describes a trade-off, never calls a pool wrong", () => {
  for (const c of fx.cases) {
    const note = buildTermYield(c.protocol).balance.note;
    assert.ok(!/should|must|error|wrong|bad/i.test(note), `prescriptive wording in: ${note}`);
  }
});

test("shares are null rather than NaN when there is nothing to divide by", () => {
  const y = buildTermYield(fx.cases[3].protocol);
  assert.equal(y.balance.vocabularyShare, null);
  assert.equal(y.coverage.selectedShare, null);
});

test("does not alias the protocol's arrays", () => {
  const c = JSON.parse(JSON.stringify(fx.cases[0]));
  const y = buildTermYield(c.protocol);
  y.terms[0].seeds.push("mutated");
  assert.ok(!c.protocol.terms.some((t: any) => t.seeds.includes("mutated")), "seeds were aliased");
});
