// Cross-repo parity for LibKey.io links: the MCP app's half.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LIBKEY_NOTE, libkeyUrl } from "../../server/libkey.js";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "libkey-parity.json");
const fx = JSON.parse(fs.readFileSync(FIXTURE, "utf-8"));

for (const c of fx.cases) {
  test(`libkey parity: ${c.name}`, () => assert.equal(libkeyUrl(c.record), c.expected));
}

// ── The rule that protects other institutions' readers ───────────────────────
test("REGRESSION: never embeds a library id — that would override the reader's own", () => {
  for (const c of fx.cases) {
    const url = libkeyUrl(c.record);
    if (url) assert.ok(!/\/libraries\//.test(url),
      `${url} pins one institution; every other reader would get the wrong holdings`);
  }
  assert.match(LIBKEY_NOTE, /No library id is embedded/);
});

test("a source given as an argument is honoured when the record omits src", () => {
  assert.equal(libkeyUrl({ pmid: "12345" }, "eric"), null, "an ERIC id must not be read as a PMID");
  assert.equal(libkeyUrl({ pmid: "12345" }, "pubmed"), "https://libkey.io/12345");
});

test("an implausibly long digit string is not treated as a PMID", () => {
  assert.equal(libkeyUrl({ src: "pubmed", pmid: "1234567890123" }), null);
});
