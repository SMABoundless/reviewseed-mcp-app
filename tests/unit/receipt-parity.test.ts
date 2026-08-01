// Cross-repo parity for the reproducibility receipt: the MCP app's half.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildReceipt, diffReceipts, receiptBasis, receiptFingerprint } from "../../server/receipt.js";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "receipt-parity.json");
const fx = JSON.parse(fs.readFileSync(FIXTURE, "utf-8"));

// The fingerprint is a published interface: it ends up written down in a methods
// section, so changing the algorithm breaks receipts already in the world. These
// pinned values are what makes that visible instead of silent.
for (const c of fx.fingerprintCases) {
  test(`fingerprint parity: ${c.name}`, () => {
    assert.equal(receiptFingerprint(c.basis), c.expected);
  });
}

for (const c of fx.receiptCases) {
  test(`receipt parity: ${c.name}`, () => {
    assert.deepStrictEqual(buildReceipt(c.protocol, c.run), c.expected);
  });
}

for (const c of fx.diffCases) {
  test(`receipt diff parity: ${c.name}`, () => {
    const d = diffReceipts(c.before, c.after);
    const e = c.expected;
    assert.equal(d.comparable, e.comparable);
    assert.deepEqual(d.changed, e.changed);
    assert.equal(d.totalBefore, e.totalBefore);
    assert.equal(d.totalAfter, e.totalAfter);
    assert.equal(d.totalDelta, e.totalDelta);
    assert.deepEqual(d.newIds, e.newIds);
    assert.deepEqual(d.goneIds, e.goneIds);
    assert.deepEqual(d.elapsed, e.elapsed);
    if ("incomparableReason" in e) assert.equal(d.incomparableReason, e.incomparableReason);
    if (e.incomparableReasonMatches) assert.ok(d.incomparableReason?.includes(e.incomparableReasonMatches),
      `reason should mention "${e.incomparableReasonMatches}": ${d.incomparableReason}`);
    assert.ok(d.interpretation.includes(e.interpretationMatches),
      `interpretation should mention "${e.interpretationMatches}": ${d.interpretation}`);
  });
}

// ── Invariants ───────────────────────────────────────────────────────────────
test("the fingerprint covers every reproducible field, and nothing volatile", () => {
  const base = { source: "pubmed" as const, query: "q", mode: "boolean" as const, framework: null, limits: [], vocabularies: [] };
  const fp = (o: Partial<typeof base>) => receiptFingerprint(receiptBasis({ ...base, ...o }));
  const original = fp({});
  assert.notEqual(fp({ query: "q2" }), original, "query must change it");
  assert.notEqual(fp({ source: "eric" }), original, "database must change it");
  assert.notEqual(fp({ mode: "framework" }), original, "builder mode must change it");
  assert.notEqual(fp({ framework: "PICO" }), original, "framework must change it");
  assert.notEqual(fp({ limits: ["Language: English"] }), original, "limits must change it");
  assert.notEqual(fp({ vocabularies: [{ key: "eric", edition: "2025" }] }), original, "vocabulary edition must change it");
});

test("a changed vocabulary EDITION changes the fingerprint — same terms, different thesaurus", () => {
  const a = receiptBasis({ source: "eric", query: "q", mode: "boolean", framework: null, limits: [], vocabularies: [{ key: "eric", edition: "2025" }] });
  const b = receiptBasis({ source: "eric", query: "q", mode: "boolean", framework: null, limits: [], vocabularies: [{ key: "eric", edition: "2026" }] });
  assert.notEqual(receiptFingerprint(a), receiptFingerprint(b));
});

test("volatile fields do NOT change the fingerprint", () => {
  const proto: any = {
    tool: { name: "ReviewSeed", version: "v4", surface: "website" },
    source: { key: "pubmed", label: "PubMed", platform: "p", api: "a" },
    query: { mode: "boolean", string: "q", framework: null },
    vocabularies: [], terms: [], filters: { summary: [] }, searchLog: [], seedRecords: [],
  };
  const a = buildReceipt({ ...proto, generatedAt: "2026-01-01T00:00:00.000Z" }, { total: 1, sampledIds: ["1"] });
  const b = buildReceipt({ ...proto, generatedAt: "2026-12-31T00:00:00.000Z" }, { total: 9999, sampledIds: ["2", "3"] });
  assert.equal(a.fingerprint, b.fingerprint, "render time, totals and ids must not affect it");
});

test("an incomparable diff reports no id movement at all", () => {
  const d = diffReceipts(
    { fingerprint: "a", sampledIds: ["1", "2"], total: 5 } as any,
    { fingerprint: "b", sampledIds: ["3", "4"], total: 9 } as any,
  );
  assert.equal(d.comparable, false);
  assert.deepEqual(d.newIds, [], "id movement between different searches is meaningless");
  assert.deepEqual(d.goneIds, []);
});

test("the sample note never implies the id list is the whole result set", () => {
  const proto: any = {
    generatedAt: "x", tool: { name: "n", version: "v", surface: "website" },
    source: { key: "pubmed", label: "PubMed", platform: "p", api: "a" },
    query: { mode: "boolean", string: "q", framework: null },
    vocabularies: [], terms: [], filters: { summary: [] }, searchLog: [], seedRecords: [],
  };
  const r = buildReceipt(proto, { sampledIds: ["1"] });
  assert.match(r.sampleNote, /not the full set/);
});
