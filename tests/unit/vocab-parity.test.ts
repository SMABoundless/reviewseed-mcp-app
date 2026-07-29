// Cross-repo parity for the MeSH vocabulary fetchers: the MCP app's half.
//
// Closes a gap that was explicitly on the "not yet parity-checked" list. Same
// approach as parser-parity: canned NLM payloads in, expected objects out, with
// the expectations GENERATED from this repo (npm run snapshot) and the website
// asserting its own fetchers produce the same objects from the same bytes.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildVocabExpected, loadVocabExpected, loadVocabInputs, runVocabCase, VOCAB_EXPECTED_PATH,
} from "../helpers/vocab-fixtures.js";
import { isSlowLookup, SLOW_LOOKUP_MS } from "../../server/mesh.js";

const inputs = loadVocabInputs();

test("vocab fixtures are non-empty (guards against a silently truncated file)", () => {
  assert.ok(inputs.cases.length > 0, "no vocab cases loaded");
  assert.ok(inputs.cases.some(c => c.fn === "meshVocabSearch"), "no search cases");
  assert.ok(inputs.cases.some(c => c.fn === "meshVocabDetails"), "no details cases");
});

test("vocab-expected.json is up to date with this repo's fetchers", async () => {
  assert.ok(fs.existsSync(VOCAB_EXPECTED_PATH), "snapshot missing — run `npm run snapshot`");
  assert.deepEqual(
    loadVocabExpected(),
    JSON.parse(JSON.stringify(await buildVocabExpected())),
    "vocab-expected.json is stale — run `npm run snapshot`, then make sure the website agrees too",
  );
});

const expected = loadVocabExpected();
for (const c of inputs.cases) {
  test(`vocab parity: ${c.name}`, async () => {
    assert.deepEqual(await runVocabCase(c), expected[c.name]);
  });
}

// ── The slow-lookup contract ────────────────────────────────────────────────
// Shared with the website, which shows the same notice past the same threshold.
// Pinned in shared-surface.json too, so the constants can't drift; these cover
// the rule itself.
test("isSlowLookup fires only at or past the threshold", () => {
  assert.equal(isSlowLookup(1_000, 1_000), false, "instant response is not slow");
  assert.equal(isSlowLookup(1_000, 1_000 + SLOW_LOOKUP_MS - 1), false, "just under the threshold");
  assert.equal(isSlowLookup(1_000, 1_000 + SLOW_LOOKUP_MS), true, "exactly at the threshold");
  assert.equal(isSlowLookup(1_000, 1_000 + 17_500), true, "the 2026-07-29 NLM latency");
});
