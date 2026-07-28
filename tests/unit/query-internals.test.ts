// Edge cases for the query builders that aren't part of the cross-repo parity
// contract (those live in tests/fixtures/query-parity.json). Anything asserted
// here is MCP-app-local behavior — if a case turns out to be shared, promote it
// into the parity fixtures instead so the website is held to it too.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBooleanQuery, buildFrameworkQuery, FRAMEWORKS } from "../../server/query.js";

const emptyPool = { keywords: [], mesh: [], eric: [], queries: [], ericQueries: [], ctQueries: [] };

test("all ten documented frameworks plus Custom are present", () => {
  const expected = ["PICO", "PICOS", "PECO", "SPICE", "CIMO", "SPIDER", "PICo", "PCC", "ECLIPSE", "PIRD", "Custom"];
  assert.deepEqual(Object.keys(FRAMEWORKS), expected);
});

test("every framework declares at least one bucket with a key and label", () => {
  for (const [key, fw] of Object.entries(FRAMEWORKS)) {
    assert.ok(fw.buckets.length > 0, `${key} has no buckets`);
    for (const b of fw.buckets) {
      assert.ok(b.key, `${key} has a bucket with no key`);
      assert.ok(b.label, `${key} bucket ${b.key} has no label`);
    }
  }
});

test("bucket keys are unique within each framework", () => {
  for (const [key, fw] of Object.entries(FRAMEWORKS)) {
    const keys = fw.buckets.map(b => b.key);
    assert.equal(new Set(keys).size, keys.length, `${key} has duplicate bucket keys`);
  }
});

test("an unknown framework key throws rather than silently returning nothing", () => {
  assert.throws(
    () => buildFrameworkQuery("NOT_A_FRAMEWORK", {}, emptyPool, {}, "pubmed"),
    /Unknown framework/,
  );
});

test("a framework with no populated buckets yields an empty string", () => {
  assert.equal(buildFrameworkQuery("PICO", {}, emptyPool, {}, "pubmed"), "");
});

test("keyword field tag defaults to tiab when unspecified", () => {
  assert.equal(
    buildBooleanQuery({ ...emptyPool, keywords: ["x"] }, {}, {}, "pubmed"),
    '"x"[tiab]',
  );
});

test("ERIC descriptors are ignored when targeting pubmed, and MeSH when targeting eric", () => {
  const pool = { ...emptyPool, mesh: ["M"], eric: ["E"] };
  assert.equal(buildBooleanQuery(pool, {}, {}, "pubmed"), '"M"[MeSH Terms]');
  assert.equal(buildBooleanQuery(pool, {}, {}, "eric"), 'subject:"E"');
});

test("trials shares the MeSH pool with pubmed (registry records carry MeSH-derived terms)", () => {
  const pool = { ...emptyPool, mesh: ["M"] };
  assert.match(buildBooleanQuery(pool, {}, {}, "trials"), /AREA\[ConditionSearch\]"M"/);
});

test("Custom framework's default buckets are usable as-is", () => {
  const pool = { ...emptyPool, keywords: ["a"] };
  assert.equal(buildFrameworkQuery("Custom", { c1: ["a"] }, pool, {}, "pubmed"), '"a"[tiab]');
});
