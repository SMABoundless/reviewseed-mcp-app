// Cross-repo parity for the per-source term formatters (MCP app's half).
// The website runs these same fixtures against its page globals.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ericKwTerm, ericDescTerm, ericAssembleTerm } from "../../server/eric.js";
import { ctKwTerm, ctMeshTerm, ctAssembleTerm } from "../../server/trials.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "formatter-parity.json");
const fixtures = JSON.parse(fs.readFileSync(FIXTURES, "utf-8")) as {
  cases: Array<{ fn: string; args: string[]; expected: string }>;
};

// Names match the website's page globals exactly, so both runners dispatch the
// same way — if a formatter is ever renamed on one side, this table breaks.
const FNS: Record<string, (...a: any[]) => string> = {
  ericKwTerm, ericDescTerm, ericAssembleTerm, ctKwTerm, ctMeshTerm, ctAssembleTerm,
};

test("formatter fixtures are non-empty", () => {
  assert.ok(fixtures.cases.length > 0);
});

for (const c of fixtures.cases) {
  test(`formatter parity: ${c.fn}(${c.args.map(a => JSON.stringify(a)).join(", ")})`, () => {
    const fn = FNS[c.fn];
    assert.ok(fn, `unknown formatter "${c.fn}" — fixture references a function this repo doesn't export`);
    assert.equal(fn(...c.args), c.expected);
  });
}
