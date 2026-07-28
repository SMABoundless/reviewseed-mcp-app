import { test } from "node:test";
import assert from "node:assert/strict";
import { matchedVia, withMatchedVia } from "../../server/match.js";
import type { Article } from "../../server/types.js";

const article = (over: Partial<Article> = {}): Article => ({
  src: "pubmed", pmid: "1", doi: "", title: "", authors: [], year: "", journal: "",
  keywords: [], mesh: [], eric: [], abstract: "", pubtypes: [], url: "", ...over,
});

test("matches a MeSH heading by exact (case-insensitive) membership", () => {
  const a = article({ mesh: ["Myocardial Infarction"] });
  assert.deepEqual(matchedVia(a, ["myocardial infarction"]), ["myocardial infarction"]);
});

test("matches an ERIC descriptor and an author keyword", () => {
  const a = article({ eric: ["Reading Comprehension"], keywords: ["phonics"] });
  assert.deepEqual(matchedVia(a, ["Reading Comprehension", "phonics"]), ["Reading Comprehension", "phonics"]);
});

test("matches a free-text term appearing in the title", () => {
  const a = article({ title: "Chronic pain management in adults" });
  assert.deepEqual(matchedVia(a, ["pain"]), ["pain"]);
});

test("matches a free-text term appearing in the abstract", () => {
  const a = article({ abstract: "We evaluated gabapentin dosing." });
  assert.deepEqual(matchedVia(a, ["gabapentin"]), ["gabapentin"]);
});

// The bug this fixed: naive substring matching reported "pain" as the reason a
// record about Spain matched.
test("REGRESSION: word-boundary, not substring — 'pain' must not match 'Spain'", () => {
  const a = article({ title: "Travel to Spain", abstract: "Nothing relevant here." });
  assert.deepEqual(matchedVia(a, ["pain"]), []);
});

test("REGRESSION: 'pain' must not match the longer word 'painful'", () => {
  const a = article({ title: "A painful procedure", abstract: "" });
  assert.deepEqual(matchedVia(a, ["pain"]), []);
});

test("multi-word phrases match as a whole phrase", () => {
  const a = article({ title: "A study of neuropathic pain outcomes" });
  assert.deepEqual(matchedVia(a, ["neuropathic pain"]), ["neuropathic pain"]);
});

test("regex metacharacters in a term are escaped, not interpreted", () => {
  const a = article({ title: "Cost (USD) analysis" });
  // Would throw or mis-match if the term were interpolated into a regex raw.
  assert.deepEqual(matchedVia(a, ["(USD)"]), ["(USD)"]);
  assert.deepEqual(matchedVia(a, ["c.st"]), []);
});

test("returns only the subset of terms that actually matched, preserving input order", () => {
  const a = article({ title: "Chronic pain", mesh: ["Neuralgia"] });
  assert.deepEqual(matchedVia(a, ["Neuralgia", "absent", "pain"]), ["Neuralgia", "pain"]);
});

test("withMatchedVia is a no-op when no terms are supplied", () => {
  const arts = [article({ title: "x" })];
  const out = withMatchedVia(arts, undefined);
  assert.equal(out[0].matchedVia, undefined);
  assert.equal(out, arts, "should return the same array reference when there is nothing to annotate");
});

test("withMatchedVia annotates each article without mutating the originals", () => {
  const arts = [article({ pmid: "1", title: "Chronic pain" }), article({ pmid: "2", title: "Unrelated" })];
  const out = withMatchedVia(arts, ["pain"]);
  assert.deepEqual(out[0].matchedVia, ["pain"]);
  assert.deepEqual(out[1].matchedVia, []);
  assert.equal((arts[0] as Article & { matchedVia?: string[] }).matchedVia, undefined, "original must not be mutated");
});
