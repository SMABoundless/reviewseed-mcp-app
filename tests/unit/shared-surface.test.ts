// Guards the shared-configuration snapshot that the website compares against.
// If this fails with "stale", run `npm run snapshot` — then expect the
// website's verify-parity.mjs to flag the same change if it wasn't made there
// too. That pair of failures IS the drift detector.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildSharedSurface, SHARED_SURFACE_PATH } from "../helpers/shared-surface.js";

test("shared-surface.json is up to date with this repo's live values", () => {
  assert.ok(fs.existsSync(SHARED_SURFACE_PATH), "snapshot missing — run `npm run snapshot`");
  const onDisk = JSON.parse(fs.readFileSync(SHARED_SURFACE_PATH, "utf-8"));
  assert.deepEqual(
    onDisk,
    JSON.parse(JSON.stringify(buildSharedSurface())),
    "shared-surface.json is stale — run `npm run snapshot`, then make sure the website agrees too",
  );
});

test("snapshot covers every field list and all eleven frameworks", () => {
  const s = buildSharedSurface();
  assert.ok(s.pubmedFields.length > 30, "PubMed's list mirrors its own advanced-search dropdown");
  assert.ok(s.ericAdvFields.length > 5);
  assert.ok(s.ctAdvFields.length > 5);
  assert.equal(Object.keys(s.frameworks).length, 11);
});

test("REGRESSION: PubMed field list includes Filter (was missing, caught by cross-repo drift check)", () => {
  const s = buildSharedSurface();
  assert.ok(s.pubmedFields.some(f => f.tag === "filter"), "the `filter` field must be present");
});

test("no duplicate field tags within a source", () => {
  const s = buildSharedSurface();
  for (const [name, list] of Object.entries({ pubmed: s.pubmedFields, eric: s.ericAdvFields, ct: s.ctAdvFields })) {
    const tags = list.map(f => f.tag);
    assert.equal(new Set(tags).size, tags.length, `${name} has duplicate tags`);
  }
});
