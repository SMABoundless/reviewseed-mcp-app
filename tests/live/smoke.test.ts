// LIVE suite — hits the real PubMed / ERIC / ClinicalTrials.gov / NLM APIs.
// Deliberately NOT part of `npm test`; run with `npm run test:live`.
//
// Purpose is narrow and different from the mocked suites: catch UPSTREAM drift
// that mocks can't see — an API moving, renaming a field, or changing response
// shape. This project has already been bitten by exactly that (ERIC moved from
// api.eric.ed.gov to api.ies.ed.gov with a breaking schema change, and its
// `descriptor` field became `subject`).
//
// Assertions are deliberately loose — shape and plausibility, not exact counts,
// which legitimately change day to day. Occasional 429s are expected here; a
// single red run is not necessarily a regression, a persistent one is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pubmedSearch } from "../../server/pubmed.js";
import { ericSearch } from "../../server/eric.js";
import { ctSearch } from "../../server/trials.js";
import { meshVocabSearch, meshVocabDetails } from "../../server/mesh.js";

const TIMEOUT = 30_000;

test("PubMed: esearch + efetch still return the fields we parse", { timeout: TIMEOUT }, async () => {
  const r = await pubmedSearch("gabapentin neuropathic pain", 1, 3);
  assert.ok(!r.error, `unexpected error: ${r.error}`);
  assert.ok(r.total > 0, "expected a non-zero total");
  assert.ok(r.articles.length > 0, "expected at least one article");
  const a = r.articles[0];
  assert.match(a.pmid, /^\d+$/, "pmid should be numeric");
  assert.ok(a.title.length > 0, "title should be populated");
  assert.ok(a.url.includes(a.pmid), "url should link to the record");
});

test("ERIC: Solr endpoint still returns the id/title/subject shape", { timeout: TIMEOUT }, async () => {
  const r = await ericSearch("reading comprehension", 1, 3);
  assert.ok(!r.error, `unexpected error: ${r.error}`);
  assert.ok(r.total > 0, "expected a non-zero total");
  const a = r.articles[0];
  assert.match(a.pmid, /^E[JD]\d+$/, "expected an EJ/ED accession number");
  assert.ok(a.title.length > 0);
  assert.ok(Array.isArray(a.eric), "descriptors should live in the `eric` array (field is `subject` upstream)");
});

test("ClinicalTrials.gov: v2 API still returns protocolSection + derived MeSH", { timeout: TIMEOUT }, async () => {
  const r = await ctSearch("asthma", 1);
  assert.ok(!r.error, `unexpected error: ${r.error}`);
  assert.ok(r.total > 0, "expected a non-zero total");
  const a = r.articles[0];
  assert.match(a.pmid, /^NCT\d{8}$/, "expected an NCT id");
  assert.ok(a.title.length > 0);
});

test("NLM MeSH: entry-term lookup + SPARQL still resolve a synonym to its descriptor", { timeout: TIMEOUT }, async () => {
  const rows = await meshVocabSearch("heart attack");
  const hit = rows.find(r => r.label === "Myocardial Infarction");
  assert.ok(hit, 'expected "heart attack" to resolve to Myocardial Infarction');
  assert.equal(hit!.via, "Heart Attack", "expected the USE cross-reference");
  assert.equal(hit!.id, "D009203");
});

test("NLM MeSH: details still return scope note, entry terms and hierarchy", { timeout: TIMEOUT }, async () => {
  const d = await meshVocabDetails("Myocardial Infarction", "D009203");
  assert.ok(d.scopeNote.length > 0, "expected a scope note");
  assert.ok(d.terms.includes("Heart Attack"), "expected entry terms");
  assert.ok(d.bt.length > 0, "expected broader descriptors");
  assert.ok(d.nt.length > 0, "expected narrower descriptors");
});

// Documents the verified asymmetry that reviewseed_search's description warns
// about. If this ever flips, the tool description needs updating.
test("truncation: PubMed/ERIC expand a trailing *, ClinicalTrials.gov does not", { timeout: TIMEOUT }, async () => {
  const [ericTrunc, ericExact] = [await ericSearch("teen*", 1, 1), await ericSearch("teenager", 1, 1)];
  assert.ok(
    ericTrunc.total > ericExact.total,
    `ERIC truncation should broaden (got ${ericTrunc.total} vs ${ericExact.total})`,
  );

  const [ctTrunc, ctExact] = [await ctSearch("diabet*", 1), await ctSearch("diabetes", 1)];
  assert.ok(
    ctTrunc.total < ctExact.total,
    `ClinicalTrials.gov should NOT truncate — "*" is literal (got ${ctTrunc.total} vs ${ctExact.total}). ` +
    "If this now passes as truncation, update reviewseed_search's tool description.",
  );
});
