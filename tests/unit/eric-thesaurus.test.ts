// Exercises the shipped ERIC Thesaurus snapshot (server/assets/*.json) — no
// network involved; ERIC has no thesaurus API, which is why the snapshot ships.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ericThesaurusSearch, ericThesaurusDetails, ERIC_THESAURUS_EDITION } from "../../server/eric-thesaurus.js";

test("edition constant is exposed for UI labelling", () => {
  assert.match(ERIC_THESAURUS_EDITION, /^\d{4}$/);
});

test("finds a descriptor by its canonical label", async () => {
  const rows = await ericThesaurusSearch("Reading Comprehension");
  assert.ok(rows && rows.length > 0, "expected at least one row");
  assert.equal(rows![0].label, "Reading Comprehension");
  assert.equal(rows![0].via, null, "a canonical-label hit should not report a `via` synonym");
});

test("finds a descriptor via a Use-For synonym and reports the cross-reference", async () => {
  const rows = await ericThesaurusSearch("gifted students");
  const hit = rows!.find(r => r.label === "Academically Gifted");
  assert.ok(hit, 'expected "gifted students" to resolve to Academically Gifted');
  assert.equal(hit!.via, "Gifted Students", "should report which synonym matched");
});

test("exact canonical matches rank above substring and synonym matches", async () => {
  const rows = await ericThesaurusSearch("Reading");
  assert.equal(rows![0].label, "Reading", "exact canonical match should sort first");
});

test("queries shorter than 2 characters return nothing (avoids scanning the whole thesaurus)", async () => {
  assert.deepEqual(await ericThesaurusSearch("a"), []);
  assert.deepEqual(await ericThesaurusSearch(""), []);
});

test("results are capped so a broad query can't flood the caller", async () => {
  const rows = await ericThesaurusSearch("education");
  assert.ok(rows!.length <= 30, `expected <= 30 rows, got ${rows!.length}`);
});

test("details returns Use-For synonyms and broader/narrower terms", async () => {
  const d = await ericThesaurusDetails("Academically Gifted");
  assert.ok(d, "expected details");
  assert.ok(d!.terms.includes("Gifted Students"), "expected the Use-For synonym");
  assert.ok(d!.bt.includes("Gifted"), "expected a broader term");
  assert.equal(d!.scopeNote, "", "ERIC's snapshot carries no scope notes (MeSH-only field)");
});

test("details is case-insensitive on the descriptor label", async () => {
  const d = await ericThesaurusDetails("academically gifted");
  assert.ok(d!.terms.length > 0, "lowercase lookup should still resolve");
});

test("an unknown descriptor yields empty arrays rather than throwing", async () => {
  const d = await ericThesaurusDetails("Not A Real ERIC Descriptor 12345");
  assert.deepEqual(d, { terms: [], bt: [], nt: [], scopeNote: "" });
});
