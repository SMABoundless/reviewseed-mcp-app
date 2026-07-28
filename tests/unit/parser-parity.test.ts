// Cross-repo parser parity (MCP app's half): identical upstream bytes in,
// identical Article objects out. The website asserts the same expectations
// against its own parsers.
//
// Also doubles as a snapshot guard — if a parser changes behavior, this fails
// with "stale", prompting `npm run snapshot` and a matching website check.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { efetchXml } from "../../server/pubmed.js";
import { parseEricDoc } from "../../server/eric.js";
import { parseCtStudy } from "../../server/trials.js";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const inputs = JSON.parse(fs.readFileSync(path.join(DIR, "parser-inputs.json"), "utf-8"));
const expected = JSON.parse(fs.readFileSync(path.join(DIR, "parser-expected.json"), "utf-8"));

const json = (v: unknown) => JSON.parse(JSON.stringify(v));

test("efetchXml parses the canonical PubMed payload as expected", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(inputs.efetchXml, { status: 200 })) as typeof fetch;
  try {
    assert.deepEqual(json(await efetchXml(inputs.efetchPmids)), expected.pubmed,
      "PubMed parser output changed — run `npm run snapshot`, then verify the website agrees");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("parseEricDoc parses the canonical ERIC doc as expected", () => {
  assert.deepEqual(json(parseEricDoc(inputs.ericDoc)), expected.eric);
});

test("parseCtStudy parses the canonical ClinicalTrials.gov study as expected", () => {
  assert.deepEqual(json(parseCtStudy(inputs.ctStudy)), expected.trials);
});

// Spot-assertions on the awkward cases the payloads deliberately include, so a
// regression names the specific behavior rather than just diffing a big object.
test("PubMed: markup is stripped from the title", () => {
  assert.equal(expected.pubmed["30567716"].title, "Attachment and burnout in clinicians.");
});

test("PubMed: a MedlineDate (no <Year>) still yields a 4-digit year", () => {
  assert.equal(expected.pubmed["22486677"].year, "1998");
});

test("PubMed: authors are capped at 4 and duplicate MeSH headings are de-duplicated", () => {
  assert.equal(expected.pubmed["30567716"].authors.length, 4);
  assert.deepEqual(expected.pubmed["30567716"].mesh, ["Burnout, Professional", "Humans"]);
});

test("PubMed: single-character keywords are dropped; multi-part abstracts are joined", () => {
  assert.deepEqual(expected.pubmed["30567716"].keywords, ["mindfulness", "burnout"]);
  assert.equal(expected.pubmed["30567716"].abstract, "First part. Second part.");
});

test("ERIC: array-valued title is unwrapped, blank/whitespace descriptors cleaned", () => {
  assert.equal(expected.eric.title, "The Science of Reading Comprehension Instruction");
  assert.deepEqual(expected.eric.eric, ["Reading Comprehension", "Reading Instruction"]);
});

test("Trials: NA phase filtered, phases humanized, condition+intervention MeSH merged", () => {
  assert.deepEqual(expected.trials.pubtypes, ["INTERVENTIONAL", "Phase 2", "Phase 3"]);
  assert.deepEqual(expected.trials.mesh, ["Asthma", "Lung Diseases", "Budesonide"]);
  assert.equal(expected.trials.ctStatus, "Active, not recruiting");
});
