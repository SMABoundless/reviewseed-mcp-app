// Search lint + PRESS self-audit (docs/REPORTS-ROADMAP.md §3.10).
//
// SHARED LOGIC. The website has a behavioral twin (index.html's page-global
// lintQuery / LINT_RULES) and both run tests/fixtures/lint-parity.json. The rule
// catalogue is also pinned in the generated shared-surface.json so the two apps
// can never disagree about which rules exist or what severity they carry.
//
// PURE and offline: string and pool inspection only.
//
// DESIGN RULE, and the reason this file is shorter than it could be: every check
// here must be one a librarian would agree with on sight. A search strategy goes
// to peer review, so a false positive costs the user credibility — worse than a
// missed check. Anything requiring data we don't have offline (heading
// redundancy needs the MeSH hierarchy; whether a limit is *justified* needs a
// human) is reported as NOT CHECKED rather than guessed at.
import type { KwFields, Pool } from "./query.js";
import type { Source } from "./types.js";

/** PRESS 2015 groups its checklist into six domains; findings map onto them. */
export type PressDomain =
  | "translation"     // 1. Translation of the research question
  | "operators"       // 2. Boolean and proximity operators
  | "subject-headings"// 3. Subject headings
  | "text-word"       // 4. Text word searching
  | "syntax"          // 5. Spelling, syntax and line numbers
  | "limits";         // 6. Limits and filters

export type Severity = "error" | "warning" | "info";

export interface LintRule {
  id: string;
  domain: PressDomain;
  severity: Severity;
  title: string;
}

export const PRESS_DOMAINS: Array<{ key: PressDomain; label: string }> = [
  { key: "translation", label: "Translation of the research question" },
  { key: "operators", label: "Boolean and proximity operators" },
  { key: "subject-headings", label: "Subject headings" },
  { key: "text-word", label: "Text word searching" },
  { key: "syntax", label: "Spelling, syntax and line numbers" },
  { key: "limits", label: "Limits and filters" },
];

export const LINT_RULES: LintRule[] = [
  { id: "unbalanced-parentheses", domain: "syntax", severity: "error", title: "Parentheses don't balance" },
  { id: "unbalanced-quotes", domain: "syntax", severity: "error", title: "Quotation marks don't balance" },
  { id: "empty-group", domain: "syntax", severity: "error", title: "Empty parenthesised group" },
  { id: "dangling-operator", domain: "operators", severity: "error", title: "Query begins or ends with an operator" },
  { id: "lowercase-operator", domain: "operators", severity: "warning", title: "Lowercase Boolean operator" },
  { id: "truncation-in-phrase", domain: "text-word", severity: "warning", title: "Truncation inside a quoted phrase" },
  { id: "field-tag-noop", domain: "text-word", severity: "warning", title: "Field tag does nothing on this source" },
  { id: "hyphenated-term", domain: "text-word", severity: "info", title: "Hyphenated term may need spelling variants" },
  { id: "very-short-keyword", domain: "text-word", severity: "info", title: "Very short keyword" },
  { id: "stopword-in-phrase", domain: "text-word", severity: "info", title: "Stopword inside a quoted phrase" },
  { id: "no-controlled-vocabulary", domain: "subject-headings", severity: "info", title: "No subject headings used" },
  { id: "no-keywords", domain: "translation", severity: "info", title: "No free-text terms used" },
  { id: "limits-need-justification", domain: "limits", severity: "info", title: "Applied limits need a stated rationale" },
];

const RULE = new Map(LINT_RULES.map(r => [r.id, r]));

/** What this linter cannot determine offline. Reported, never guessed. */
export const LINT_NOT_CHECKED = [
  "Whether a pooled heading is already covered by exploding a broader one — that needs the MeSH/ERIC hierarchy, so use the vocabulary landscape or the evidence gap map.",
  "Whether an applied limit is justified for this question — PRESS asks for a rationale, which only you can supply.",
  "Spelling of individual terms, and whether British/American variants are both present.",
  "Whether the concepts themselves match the research question — the first PRESS domain is a human judgement.",
];

export interface LintFinding {
  rule: string;
  domain: PressDomain;
  severity: Severity;
  title: string;
  detail: string;
  /** The specific term or fragment at fault, when there is one. */
  subject?: string;
}

export interface LintInput {
  source: Source;
  query: string;
  pool?: Pool;
  kwFields?: KwFields;
  /** Human-readable limits already applied, as the protocol reports them. */
  filterSummary?: string[];
}

export interface LintResult {
  findings: LintFinding[];
  counts: { error: number; warning: number; info: number };
  byDomain: Array<{ domain: PressDomain; label: string; findings: LintFinding[] }>;
  notChecked: string[];
  clean: boolean;
}

// PubMed drops stopwords from a phrase search, so a quoted phrase containing one
// can match text where the connecting word differs. Kept deliberately short:
// every entry here produces a user-visible note, and a long list would bury the
// findings that matter.
const STOPWORDS = new Set(["a", "an", "the", "of", "in", "on", "for", "with", "to", "and", "or"]);

/** Strip quoted spans so operator/paren checks don't trip over quoted content. */
const outsideQuotes = (q: string): string => q.replace(/"[^"]*"/g, '""');

function push(out: LintFinding[], id: string, detail: string, subject?: string): void {
  const r = RULE.get(id);
  if (!r) return;
  out.push({ rule: r.id, domain: r.domain, severity: r.severity, title: r.title, detail, ...(subject ? { subject } : {}) });
}

export function lintQuery(input: LintInput): LintResult {
  const { source, query, pool, kwFields = {}, filterSummary = [] } = input;
  const q = (query || "").replace(/\n/g, " ").trim();
  const out: LintFinding[] = [];

  // ── Syntax: unambiguous, and each one breaks or silently mis-groups a search ──
  const quotes = (q.match(/"/g) || []).length;
  if (quotes % 2 !== 0) {
    push(out, "unbalanced-quotes", `The query contains ${quotes} quotation marks. An unclosed phrase makes the rest of the query part of that phrase.`);
  }
  const bare = outsideQuotes(q);
  let depth = 0, negative = false;
  for (const ch of bare) {
    if (ch === "(") depth++;
    else if (ch === ")") { depth--; if (depth < 0) { negative = true; break; } }
  }
  if (negative || depth !== 0) {
    push(out, "unbalanced-parentheses", negative
      ? "A closing parenthesis appears before its opening one."
      : `${Math.abs(depth)} parenthes${Math.abs(depth) === 1 ? "is is" : "es are"} left unclosed.`);
  }
  if (/\(\s*\)/.test(bare)) {
    push(out, "empty-group", "An empty () group is either a leftover or a term that failed to render.");
  }

  // ── Operators ──
  if (q) {
    const dangling = bare.match(/^\s*(AND|OR|NOT)\b/i) || bare.match(/\b(AND|OR|NOT)\s*$/i);
    if (dangling) push(out, "dangling-operator", `The query starts or ends with "${dangling[1]}", so one side of it is missing.`);
    // Our builders always emit uppercase; a lowercase operator means a pasted
    // snippet. PubMed tolerates it, Ovid and Embase.com do not.
    const lower = bare.match(/(?:^|\s)(and|or|not)(?=\s)/);
    if (lower) {
      push(out, "lowercase-operator", `"${lower[1]}" reads as an operator here. PubMed accepts lowercase; Ovid and Embase.com treat it as a search term. Uppercase it before translating this strategy.`, lower[1]);
    }
  }

  // ── Text words ──
  for (const m of q.matchAll(/"([^"]*)"/g)) {
    const phrase = m[1];
    if (phrase.includes("*")) {
      push(out, "truncation-in-phrase", `PubMed and ERIC do not expand a wildcard inside a quoted phrase, so "${phrase}" is searched literally. Truncate an unquoted single word instead, or list the variants.`, phrase);
    }
    const stop = phrase.toLowerCase().split(/\s+/).find(w => STOPWORDS.has(w));
    if (stop && phrase.trim().includes(" ")) {
      push(out, "stopword-in-phrase", `PubMed ignores stopwords inside a phrase, so "${phrase}" can also match text where "${stop}" is a different word. Usually harmless; worth checking if the phrase depends on it.`, phrase);
    }
  }

  for (const term of pool?.keywords ?? []) {
    if (term.includes("-")) {
      push(out, "hyphenated-term", `"${term}" is hyphenated. Databases treat hyphens inconsistently — consider adding the closed and spaced forms too.`, term);
    }
    if (term.trim().length <= 2) {
      push(out, "very-short-keyword", `"${term}" is very short and will match far more than intended, or be dropped outright.`, term);
    }
    // Documented divergence, not a guess: ClinicalTrials.gov has no
    // abstract-only field, so the `ab` tag has nothing to restrict to.
    if (source === "trials" && kwFields[term] === "ab") {
      push(out, "field-tag-noop", `"${term}" is tagged abstract-only, which ClinicalTrials.gov has no field for — the term ends up searching everything.`, term);
    }
  }

  // ── Translation and subject headings ──
  const kwCount = pool?.keywords?.length ?? 0;
  const vocabCount = (pool?.mesh?.length ?? 0) + (pool?.eric?.length ?? 0);
  if (pool && kwCount + vocabCount > 0) {
    if (vocabCount === 0) {
      push(out, "no-controlled-vocabulary", `${source === "eric" ? "ERIC Thesaurus descriptors" : "MeSH headings"} would add precision and survive rephrasing. Free-text-only is a defensible choice — PRESS asks that it be a choice.`);
    }
    if (kwCount === 0) {
      push(out, "no-keywords", "Headings alone miss records that aren't indexed yet, which skews against recent work. Free-text terms cover that gap.");
    }
  }

  // ── Limits ──
  if (filterSummary.length) {
    push(out, "limits-need-justification", `${filterSummary.length} limit${filterSummary.length === 1 ? "" : "s"} applied (${filterSummary.join("; ")}). PRESS asks for the rationale to be stated, and for language or date limits especially to be defended.`);
  }

  const order: Severity[] = ["error", "warning", "info"];
  out.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity) || a.rule.localeCompare(b.rule) || (a.subject ?? "").localeCompare(b.subject ?? ""));

  return {
    findings: out,
    counts: {
      error: out.filter(f => f.severity === "error").length,
      warning: out.filter(f => f.severity === "warning").length,
      info: out.filter(f => f.severity === "info").length,
    },
    byDomain: PRESS_DOMAINS.map(d => ({ domain: d.key, label: d.label, findings: out.filter(f => f.domain === d.key) })),
    notChecked: [...LINT_NOT_CHECKED],
    clean: out.length === 0,
  };
}
