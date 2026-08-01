// Cross-repo parity for methodological filters: the MCP app's half.
//
// A hedge is a published artifact — one wrong character silently changes the
// recall of somebody's review — so these tests check provenance and honesty as
// hard as they check behavior.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyHedge, getHedge, HEDGE_CAVEAT, HEDGES, hedgesFor } from "../../server/hedges.js";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "hedge-parity.json");
const fx = JSON.parse(fs.readFileSync(FIXTURE, "utf-8"));

for (const c of fx.cases) {
  test(`hedge parity: ${c.name}`, () => {
    const h = getHedge(c.hedge);
    assert.ok(h, `unknown hedge "${c.hedge}"`);
    assert.equal(applyHedge(c.query, h!), c.expected);
  });
}

// ── Provenance is not optional ───────────────────────────────────────────────
test("every hedge names a publisher and a citation", () => {
  for (const h of HEDGES) {
    assert.ok(h.publisher.length > 3, `${h.id} has no publisher`);
    assert.ok(h.citation.length > 10, `${h.id} has no usable citation`);
    assert.ok(h.tradeoff.length > 30, `${h.id} must state its trade-off, not just exist`);
    assert.ok(h.purpose.length > 15, `${h.id} needs a plain-language purpose`);
  }
});

test("an unvalidated filter says so in the data, and in its own label", () => {
  const unvalidated = HEDGES.filter(h => !h.validated);
  assert.ok(unvalidated.length > 0, "the fixture set includes one on purpose");
  for (const h of unvalidated) {
    assert.match(h.citation, /not a published filter/i, `${h.id} must not imply publication`);
    assert.match(h.tradeoff, /NOT a validated filter/i, `${h.id} must warn in its trade-off`);
    assert.match(h.label, /unvalidated/i, `${h.id}'s label must carry the warning too`);
  }
});

test("a validated filter never claims 'none' as its publisher", () => {
  for (const h of HEDGES.filter(h => h.validated)) {
    assert.ok(!/^none/i.test(h.publisher), `${h.id} claims validation with no publisher`);
  }
});

test("the caveat states that these are transcriptions to be re-checked", () => {
  assert.match(HEDGE_CAVEAT, /transcription/i);
  assert.match(HEDGE_CAVEAT, /check the citation|current published version/i);
});

// ── Catalogue shape ──────────────────────────────────────────────────────────
test("ids are unique and every source has at least one filter", () => {
  const ids = HEDGES.map(h => h.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate hedge id");
  for (const src of ["pubmed", "eric", "trials"] as const) {
    assert.ok(hedgesFor(src).length > 0, `${src} has no filters`);
    assert.ok(hedgesFor(src).every(h => h.source === src));
  }
});

test("an id is prefixed with its source, so a filter can't be applied to the wrong database", () => {
  for (const h of HEDGES) {
    const prefix = h.source === "trials" ? "trials-" : `${h.source}-`;
    assert.ok(h.id.startsWith(prefix), `${h.id} should start with ${prefix}`);
  }
});

test("the query is always parenthesised — the silent-rebind failure", () => {
  const h = getHedge("pubmed-systematic-reviews")!;
  const out = applyHedge("a OR b", h);
  assert.ok(out.startsWith("(a OR b)"), `unwrapped query would rebind the OR: ${out}`);
});
