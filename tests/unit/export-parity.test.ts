// Cross-repo parity for the screening handoff: the MCP app's half.
//
// These files are read by other people's software, so the fixtures are
// byte-exact — including CRLF line endings, which Covidence and EndNote care
// about and which a casual refactor would quietly convert to LF.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  csvCell, dedupeRecords, prismaCounts, texEscape, toBibtex, toCsv, toRis,
} from "../../server/export.js";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "export-parity.json");
const fx = JSON.parse(fs.readFileSync(FIXTURE, "utf-8"));
const pick = (names: string[]) => names.map(n => fx.records[n]);

for (const c of fx.risCases) {
  test(`RIS parity: ${c.name}`, () => assert.equal(toRis(pick(c.records)), c.expected));
}
for (const c of fx.bibtexCases) {
  test(`BibTeX parity: ${c.name}`, () => assert.equal(toBibtex(pick(c.records)), c.expected));
}
for (const c of fx.csvCases) {
  test(`CSV parity: ${c.name}`, () => assert.equal(toCsv(pick(c.records)), c.expected));
}
for (const c of fx.cellCases) {
  test(`CSV cell parity: ${c.name}`, () => assert.equal(csvCell(c.value), c.expected));
}
for (const c of fx.texCases) {
  test(`TeX escape parity: ${c.name}`, () => assert.equal(texEscape(c.value), c.expected));
}
for (const c of fx.dedupeCases) {
  test(`dedupe parity: ${c.name}`, () => {
    const d = dedupeRecords(c.records);
    assert.deepEqual(d.records.map((r: any) => r.pmid), c.expectedKept);
    assert.deepEqual(d.removedIds, c.expectedRemoved);
    assert.equal(d.removed, c.expectedRemoved.length);
  });
}

// ── Format invariants ────────────────────────────────────────────────────────
test("RIS uses CRLF everywhere and never a bare LF", () => {
  const ris = toRis(pick(["pubmedFull", "ericDocument"]));
  assert.ok(!/[^\r]\n/.test(ris), "found an LF not preceded by CR");
  assert.ok(ris.includes("\r\n"), "no CRLF at all");
});

test("every RIS tag is exactly two spaces before the dash", () => {
  for (const line of toRis(pick(["pubmedFull"])).split("\r\n").filter(Boolean)) {
    assert.match(line, /^[A-Z][A-Z0-9]  - /, `malformed RIS line: ${JSON.stringify(line)}`);
  }
});

test("each RIS record opens with TY and closes with ER", () => {
  const recs = toRis(pick(["pubmedFull", "ericDocument"])).split("\r\n\r\n");
  assert.equal(recs.length, 2);
  for (const r of recs) {
    assert.ok(r.startsWith("TY  - "), "must open with TY");
    assert.ok(r.trimEnd().endsWith("ER  -"), "must close with ER");
  }
})

test("an abstract's newlines are flattened — a bare newline breaks an RIS field", () => {
  const ris = toRis(pick(["pubmedFull"]));
  assert.ok(ris.includes("AB  - Line one. Line two."));
});

test("BibTeX keys are unique across a realistic set", () => {
  const keys = toBibtex(pick(["pubmedFull", "websiteShaped", "ericDocument", "trialRegistration"]))
    .match(/@\w+\{([^,]+),/g) ?? [];
  assert.equal(new Set(keys).size, keys.length, "a duplicate key makes BibTeX drop a reference silently");
});

// ── PRISMA counts ────────────────────────────────────────────────────────────
test("PRISMA counts use the LATEST search per database, not every search", () => {
  const p = prismaCounts([
    { at: "t1", source: "pubmed", query: "q", total: 100 },
    { at: "t2", source: "pubmed", query: "q2", total: 120 },
    { at: "t3", source: "eric", query: "e", total: 7 },
  ], 5, 1);
  assert.deepEqual(p.identified.map(i => [i.source, i.total]), [["pubmed", 120], ["eric", 7]]);
  assert.equal(p.identifiedTotal, 127);
  assert.equal(p.exported, 5);
  assert.equal(p.duplicatesRemoved, 1);
});

test("PRISMA counts name the numbers ReviewSeed cannot know", () => {
  const p = prismaCounts([], 0, 0);
  assert.equal(p.identifiedTotal, null, "no searches means no total, not zero");
  assert.ok(p.notRecorded.some(s => /screened/i.test(s)));
  assert.ok(p.notRecorded.some(s => /hand-searching|citation-chasing/i.test(s)));
});

test("dedupe says plainly that cross-database duplicates are not its job", () => {
  const d = dedupeRecords([{ pmid: "1" }]);
  assert.match(d.note, /ACROSS databases/);
  assert.match(d.note, /screening tool/);
});
