// Cross-repo parity for the emit-only database translations: the MCP app's half.
//
// The fixtures are hand-pinned vendor syntax (see the file's comment). The
// website runs the same file through its own page globals. If either drifts,
// one side goes red — and a drifted translation is a librarian pasting a broken
// string into Ovid, so this is not a cosmetic check.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPlatformQuery, buildTranslationMatrix, PLATFORMS, PLATFORM_CAVEAT, platformTerm, untranslated,
} from "../../server/translate.js";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "translation-parity.json");
const fx = JSON.parse(fs.readFileSync(FIXTURE, "utf-8"));

test("translation fixtures are non-empty (guards against a silently truncated file)", () => {
  assert.ok(fx.termCases.length > 0, "no term cases");
  assert.ok(fx.queryCases.length > 0, "no query cases");
  assert.ok(fx.untranslatedCases.length > 0, "no untranslated cases");
});

for (const c of fx.termCases) {
  test(`translation parity: ${c.name}`, () => {
    assert.equal(platformTerm(c.platform, c.kind, c.term, c.tag), c.expected);
  });
}

for (const c of fx.queryCases) {
  test(`translation parity: ${c.name}`, () => {
    assert.equal(buildPlatformQuery(c.platform, c.pool, c.kwFields), c.expected);
  });
}

for (const c of fx.untranslatedCases) {
  test(`translation parity: ${c.name}`, () => {
    assert.deepEqual(untranslated(c.pool), c.expected);
  });
}

// ── Invariants that protect the honesty of the output ───────────────────────
test("every fixture platform is a real platform, and every platform is covered", () => {
  const keys = new Set(PLATFORMS.map(p => p.key));
  const covered = new Set<string>();
  for (const c of [...fx.termCases, ...fx.queryCases]) {
    assert.ok(keys.has(c.platform), `fixture names unknown platform "${c.platform}"`);
    covered.add(c.platform);
  }
  const missing = [...keys].filter(k => !covered.has(k));
  assert.deepEqual(missing, [], `platforms with no fixture case: ${missing.join(", ")}`);
});

test("every platform documents what its syntax cannot do", () => {
  for (const p of PLATFORMS) {
    assert.ok(p.note.length > 20, `${p.key} needs a real note, not a placeholder`);
    assert.ok(p.label && p.vendor, `${p.key} is missing label or vendor`);
  }
});

test("platforms without a thesaurus say so, rather than pretending to explode", () => {
  for (const key of ["scopus", "wos"] as const) {
    const p = PLATFORMS.find(x => x.key === key)!;
    assert.equal(p.vocabulary, "", `${key} must not claim a controlled vocabulary`);
    assert.ok(!/exp|\+/.test(p.vocab("Heading")), `${key} must not emit an explode operator`);
  }
});

test("the matrix carries the untested caveat and every platform", () => {
  const m = buildTranslationMatrix(
    { keywords: ["asthma"], mesh: ["Asthma"], eric: [], queries: ["x"], ericQueries: [], ctQueries: [] },
    {},
  );
  assert.match(m.caveat, /UNTESTED/);
  assert.equal(m.platforms.length, PLATFORMS.length);
  assert.deepEqual(m.untranslated, ["x"], "pooled snippets must be reported, not dropped silently");
  for (const p of m.platforms) assert.ok(p.query.length > 0, `${p.key} produced no query`);
  assert.equal(m.caveat, PLATFORM_CAVEAT);
});

test("an unknown platform key degrades instead of throwing", () => {
  assert.equal(buildPlatformQuery("nope" as never, { keywords: ["a"], mesh: [], eric: [], queries: [], ericQueries: [], ctQueries: [] }), "");
  assert.equal(platformTerm("nope" as never, "keyword", "a"), "a");
});
