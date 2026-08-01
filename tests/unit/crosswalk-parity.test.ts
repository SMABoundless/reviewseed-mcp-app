// Cross-repo parity for the MeSH-ERIC crosswalk: the MCP app's half.
//
// The thesaurus fragments and the cases are real. Two of them (Mindfulness ->
// Metacognition, Asthma -> Diseases) are cases where the strongest available
// signal produces a conceptually wrong suggestion — which is the whole reason
// this feature reports candidates with evidence instead of a mapping.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCrosswalkReport, CROSSWALK_CAVEAT, crosswalkCandidates, meshHead, normalizeVocabLabel,
} from "../../server/crosswalk.js";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "crosswalk-parity.json");
const fx = JSON.parse(fs.readFileSync(FIXTURE, "utf-8"));

for (const c of fx.normalizeCases) {
  test(`normalize parity: ${c.name}`, () => assert.equal(normalizeVocabLabel(c.label), c.expected));
}
for (const c of fx.headCases) {
  test(`mesh head parity: ${c.name}`, () => assert.equal(meshHead(c.label), c.expected));
}
for (const c of fx.crosswalkCases) {
  test(`crosswalk parity: ${c.name}`, () => {
    const r = crosswalkCandidates(c.meshLabel, c.meshEntryTerms, fx.thesaurus);
    assert.deepEqual(r.matches.map(m => ({ descriptor: m.descriptor, kind: m.kind, confidence: m.confidence })),
      c.expected.map((e: any) => ({ descriptor: e.descriptor, kind: e.kind, confidence: e.confidence })));
    for (const e of c.expected) {
      const got = r.matches.find(m => m.descriptor === e.descriptor)!;
      assert.ok(got.evidence.includes(e.evidenceMatches),
        `${e.descriptor} evidence should contain "${e.evidenceMatches}": ${got.evidence}`);
    }
    assert.equal(r.none, c.expected.length === 0);
  });
}

// ── Invariants ───────────────────────────────────────────────────────────────
test("a synonym match is never rated strong — ERIC may have folded the concept in", () => {
  const r = crosswalkCandidates("Mindfulness", [], fx.thesaurus);
  assert.equal(r.matches[0].descriptor, "Metacognition");
  assert.notEqual(r.matches[0].confidence, "strong",
    "the Mindfulness/Metacognition case is conceptually wrong and must not be presented as certain");
});

test("only a label match can be strong", () => {
  for (const c of fx.crosswalkCases) {
    for (const m of crosswalkCandidates(c.meshLabel, c.meshEntryTerms, fx.thesaurus).matches) {
      if (m.confidence === "strong") assert.equal(m.kind, "same-label", `${m.kind} must not be rated strong`);
    }
  }
});

test("every match states the evidence for itself", () => {
  for (const c of fx.crosswalkCases) {
    for (const m of crosswalkCandidates(c.meshLabel, c.meshEntryTerms, fx.thesaurus).matches) {
      assert.ok(m.evidence.length > 25, `${m.descriptor} has no usable evidence`);
    }
  }
});

test("a descriptor is never listed twice", () => {
  const r = crosswalkCandidates("Burnout", ["Teacher Burnout", "Burnout"], fx.thesaurus);
  const seen = r.matches.map(m => m.descriptor);
  assert.equal(new Set(seen).size, seen.length);
});

test("the caveat says no official mapping exists and names the synonym risk", () => {
  assert.match(CROSSWALK_CAVEAT, /No official MeSH–ERIC mapping exists/);
  assert.match(CROSSWALK_CAVEAT, /synonym match is the least trustworthy/);
  assert.match(CROSSWALK_CAVEAT, /the word can match while the concept does not/);
});

test("finding nothing is reported as a real answer", () => {
  const rep = buildCrosswalkReport([crosswalkCandidates("Myocardial Infarction", [], fx.thesaurus)]);
  assert.equal(rep.counts.withoutMatches, 1);
  assert.match(rep.summary, /That is a real answer/);
});

test("an empty pool is distinguished from a pool with no matches", () => {
  assert.match(buildCrosswalkReport([]).summary, /nothing to cross-walk/);
});
