// Cross-repo parity for terminology drift: the MCP app's half.
//
// Every note in the fixtures is real, copied from NLM's live endpoint, because
// the format is far less regular than documentation implies.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assessDrift, buildDriftReport, MESH_BASELINE_YEAR, meshHistoryQuery, parseHistoryNote,
} from "../../server/drift.js";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "drift-parity.json");
const fx = JSON.parse(fs.readFileSync(FIXTURE, "utf-8"));

for (const c of fx.noteCases) {
  test(`history note parity: ${c.name}`, () => {
    const p = parseHistoryNote(c.note);
    assert.deepEqual(p.priorHeadings, c.expected.priorHeadings);
    assert.equal(p.hasUnparsedText, c.expected.hasUnparsedText);
    assert.equal(p.raw, c.note.trim());
  });
}

for (const c of fx.driftCases) {
  test(`drift parity: ${c.name}`, () => {
    const f = assessDrift(c.input);
    assert.equal(f.verdict, c.expectedVerdict);
    assert.equal(f.introducedYear, c.expectedYear);
    assert.ok(f.message.includes(c.messageMatches),
      `message should contain "${c.messageMatches}": ${f.message}`);
  });
}

for (const c of fx.queryCases) {
  test(`history query parity: ${c.name}`, () => {
    const q = meshHistoryQuery(c.id);
    for (const frag of c.mustContain) assert.ok(q.includes(frag), `query must contain ${frag}`);
  });
}

// ── Invariants ───────────────────────────────────────────────────────────────
test("the query asks only for predicates that actually exist", () => {
  const q = meshHistoryQuery("D000001");
  // Verified live 2026-08-01: MeSH RDF has no dateCreated and no previousIndexing,
  // despite both appearing in older documentation. Asking for them returns nothing.
  assert.ok(!/dateCreated|previousIndexing/.test(q),
    "these predicates do not exist in MeSH RDF — asking for them silently returns empty");
});

test("a gap is never reported as covered just because a replacement exists", () => {
  const f = assessDrift({
    label: "X", dateIntroduced: "2000-01-01",
    historyNote: "2000; use OLD HEADING 1990-1999", coverageFrom: 1990,
  });
  assert.equal(f.verdict, "gap", "a named replacement does not close the gap by itself");
  assert.match(f.message, /cannot retrieve them/);
});

test("the baseline year is MEDLINE's, and headings at or before it are exempt", () => {
  assert.equal(MESH_BASELINE_YEAR, 1966);
  assert.equal(assessDrift({ label: "A", dateIntroduced: "1963-01-01" }).verdict, "baseline");
  assert.equal(assessDrift({ label: "B", dateIntroduced: "1967-01-01" }).verdict, "gap");
});

test("the raw note always travels with the finding, parsed or not", () => {
  const weird = "2020; something we do not understand at all in this note";
  const f = assessDrift({ label: "X", dateIntroduced: "2020-01-01", historyNote: weird });
  assert.equal(f.historyNote, weird);
  assert.equal(f.hasUnparsedNote, true, "unparsed text must be admitted, not hidden");
});

test("a report summarises without overstating: gaps are indexing, not literature", () => {
  const r = buildDriftReport([
    { label: "Mindfulness", dateIntroduced: "2014-01-01", historyNote: "2014" },
    { label: "Asthma", dateIntroduced: "1966-01-01" },
  ], null);
  assert.equal(r.counts.gap, 1);
  assert.equal(r.counts.baseline, 1);
  assert.match(r.summary, /gap in the indexing, not in the literature/);
});

test("an empty pool says so rather than reporting a clean bill of health", () => {
  const r = buildDriftReport([], 1990);
  assert.match(r.summary, /nothing to check/);
  assert.deepEqual(r.findings, []);
});
