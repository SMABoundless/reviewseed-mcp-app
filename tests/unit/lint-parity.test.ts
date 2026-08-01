// Cross-repo parity for the search lint / PRESS self-audit: the MCP app's half.
//
// Fixtures compare the FULL finding list, so a rule firing where the fixture says
// it shouldn't is a failure. That's deliberate: this output goes into a
// peer-review audit, where a false positive costs the user credibility.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LINT_RULES, LINT_NOT_CHECKED, lintQuery, PRESS_DOMAINS } from "../../server/lint.js";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "lint-parity.json");
const fx = JSON.parse(fs.readFileSync(FIXTURE, "utf-8"));

// Compare rule/severity/domain/subject — the detail prose is asserted separately
// so a wording improvement doesn't force every case to be rewritten.
const shape = (f: any) => ({ rule: f.rule, severity: f.severity, domain: f.domain, ...(f.subject ? { subject: f.subject } : {}) });

test("lint fixtures are non-empty and include the clean case", () => {
  assert.ok(fx.cases.length > 0);
  assert.ok(fx.cases.some((c: any) => c.expected.length === 0), "at least one case must assert NO findings");
});

for (const c of fx.cases) {
  test(`lint parity: ${c.name}`, () => {
    assert.deepStrictEqual(lintQuery(c.input).findings.map(shape), c.expected);
  });
}

// ── Invariants ───────────────────────────────────────────────────────────────
test("every rule the fixtures exercise is in the catalogue, and vice versa", () => {
  const catalogue = new Set(LINT_RULES.map(r => r.id));
  const exercised = new Set<string>();
  for (const c of fx.cases) for (const f of c.expected) {
    assert.ok(catalogue.has(f.rule), `fixture names unknown rule "${f.rule}"`);
    exercised.add(f.rule);
  }
  const untested = [...catalogue].filter(id => !exercised.has(id));
  assert.deepEqual(untested, [], `rules with no fixture case: ${untested.join(", ")}`);
});

test("every rule declares a real PRESS domain", () => {
  const domains = new Set(PRESS_DOMAINS.map(d => d.key));
  for (const r of LINT_RULES) {
    assert.ok(domains.has(r.domain), `${r.id} has domain "${r.domain}"`);
    assert.ok(r.title.length > 5, `${r.id} needs a real title`);
  }
});

test("only genuinely broken syntax is an error; judgement calls are info", () => {
  const errors = LINT_RULES.filter(r => r.severity === "error").map(r => r.id);
  assert.deepEqual(errors.sort(), ["dangling-operator", "empty-group", "unbalanced-parentheses", "unbalanced-quotes"],
    "an error must mean the query cannot run as written, not that we disagree with it");
});

test("findings explain themselves and never issue orders", () => {
  const r = lintQuery({
    source: "pubmed",
    query: '("heart attack*"[tiab] and "quality of life"[tiab]',
    filterSummary: ["Language: English"],
  });
  for (const f of r.findings) {
    assert.ok(f.detail.length > 30, `${f.rule} needs an explanation, not a label`);
    assert.ok(!/\byou must\b|\bnever do\b|\bwrong\b/i.test(f.detail), `${f.rule} is prescriptive: ${f.detail}`);
  }
});

test("what it cannot check is stated, not guessed", () => {
  const r = lintQuery({ source: "pubmed", query: '"a"[tiab]' });
  assert.ok(r.clean, "a well-formed query is clean");
  assert.equal(r.notChecked.length, LINT_NOT_CHECKED.length);
  assert.ok(r.notChecked.some(s => /hierarchy/.test(s)), "heading redundancy needs data we don't have offline");
  assert.ok(r.notChecked.some(s => /justified|rationale/.test(s)), "limit justification is a human judgement");
});

test("byDomain covers all six PRESS domains even when empty", () => {
  const r = lintQuery({ source: "pubmed", query: '"a"[tiab]' });
  assert.deepEqual(r.byDomain.map(d => d.domain), PRESS_DOMAINS.map(d => d.key));
  assert.ok(r.byDomain.every(d => Array.isArray(d.findings)));
});
