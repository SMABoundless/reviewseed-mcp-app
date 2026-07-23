import { ericDescTerm, ericKwTerm } from "./eric.js";
import { ctKwTerm, ctMeshTerm } from "./trials.js";
import type { Source } from "./types.js";

export interface Pool {
  keywords: string[];
  mesh: string[];   // shared MeSH pool — feeds both PubMed and Trials
  eric: string[];   // ERIC descriptor pool
  queries: string[];    // assembled PubMed advanced-search snippets
  ericQueries: string[]; // assembled ERIC advanced-search snippets
  ctQueries: string[];   // assembled ClinicalTrials.gov advanced-search snippets
}

export type KwFields = Record<string, string>; // term -> PubMed field tag (tiab/ti/ab/all)

function kwTerm(term: string, kwFields: KwFields, target: Source): string {
  const tag = kwFields[term] ?? "tiab";
  if (target === "eric") return ericKwTerm(term, tag);
  if (target === "trials") return ctKwTerm(term, tag);
  return `"${term}"[${tag}]`;
}

function vocabTerm(term: string, target: Source): string {
  if (target === "eric") return ericDescTerm(term);
  if (target === "trials") return ctMeshTerm(term);
  return `"${term}"[MeSH Terms]`;
}

export function buildBooleanQuery(
  pool: Pool,
  kwFields: KwFields,
  opts: { kwOp?: "OR" | "AND"; vocabOp?: "OR" | "AND"; joinOp?: "AND" | "OR" },
  target: Source,
): string {
  const kwOp = opts.kwOp ?? "OR", vocabOp = opts.vocabOp ?? "OR", joinOp = opts.joinOp ?? "AND";
  const parts: string[] = [];
  if (pool.keywords.length) {
    const inner = pool.keywords.map(t => kwTerm(t, kwFields, target)).join(` ${kwOp} `);
    parts.push(pool.keywords.length > 1 ? `(${inner})` : inner);
  }
  // MeSH is shared by PubMed and ClinicalTrials.gov; ERIC has its own descriptor pool.
  const vocab = target === "eric" ? pool.eric : pool.mesh;
  if (vocab.length) {
    const inner = vocab.map(t => vocabTerm(t, target)).join(` ${vocabOp} `);
    parts.push(vocab.length > 1 ? `(${inner})` : inner);
  }
  const queries = target === "eric" ? pool.ericQueries : target === "trials" ? pool.ctQueries : pool.queries;
  // Advanced-search snippets may contain their own AND/OR/NOT — always
  // parenthesize so the join operator can't rebind them.
  queries.forEach(q => parts.push(`(${q})`));
  return parts.join(` ${joinOp} `);
}

export interface FrameworkBucketDef { key: string; label: string; hint?: string }
export interface FrameworkDef {
  label: string;
  full: string;
  tag: string;
  blurb: string;
  buckets: FrameworkBucketDef[];
  custom?: boolean;
}

// All ten established frameworks the site offers, plus Custom (user-defined
// 1-6 concept groups). Data ported verbatim from index.html's FRAMEWORKS.
export const FRAMEWORKS: Record<string, FrameworkDef> = {
  PICO:    { label: "PICO",    full: "Population · Intervention · Comparison · Outcome", tag: "Clinical trials", blurb: "Workhorse for intervention questions with a measurable endpoint.", buckets: [{ key: "P", label: "Population" }, { key: "I", label: "Intervention" }, { key: "C", label: "Comparison" }, { key: "O", label: "Outcome" }] },
  PICOS:   { label: "PICOS",   full: "Population · Intervention · Comparison · Outcome · Study design", tag: "Systematic reviews", blurb: "PICO + study design as an explicit search element.", buckets: [{ key: "P", label: "Population" }, { key: "I", label: "Intervention" }, { key: "C", label: "Comparison" }, { key: "O", label: "Outcome" }, { key: "S", label: "Study design" }] },
  PECO:    { label: "PECO",    full: "Population · Exposure · Comparison · Outcome", tag: "Epidemiology", blurb: "Exposures rather than administered interventions.", buckets: [{ key: "P", label: "Population" }, { key: "E", label: "Exposure" }, { key: "C", label: "Comparison" }, { key: "O", label: "Outcome" }] },
  SPICE:   { label: "SPICE",   full: "Setting · Population · Intervention · Comparison · Evaluation", tag: "Services research", blurb: "Foregrounds context — where and for whom.", buckets: [{ key: "S", label: "Setting" }, { key: "P", label: "Population" }, { key: "I", label: "Intervention" }, { key: "C", label: "Comparison" }, { key: "E", label: "Evaluation" }] },
  CIMO:    { label: "CIMO",    full: "Context · Intervention · Mechanisms · Outcome", tag: "Realist synthesis", blurb: "Why something worked, not just whether.", buckets: [{ key: "C", label: "Context" }, { key: "I", label: "Intervention" }, { key: "M", label: "Mechanisms" }, { key: "O", label: "Outcome" }] },
  SPIDER:  { label: "SPIDER",  full: "Sample · Phenomenon · Design · Evaluation · Research Type", tag: "Qualitative", blurb: "Filters by methodology as well as topic.", buckets: [{ key: "S", label: "Sample" }, { key: "PI", label: "Phenomenon of Interest" }, { key: "D", label: "Design" }, { key: "E", label: "Evaluation" }, { key: "R", label: "Research Type" }] },
  PICo:    { label: "PICo",    full: "Population · phenomenon of Interest · Context", tag: "Qualitative, broad", blurb: "Simpler qualitative alternative to SPIDER.", buckets: [{ key: "P", label: "Population" }, { key: "I", label: "Phenomenon of Interest" }, { key: "C", label: "Context" }] },
  PCC:     { label: "PCC",     full: "Population · Concept · Context", tag: "Scoping reviews", blurb: "JBI-endorsed for mapping what is known.", buckets: [{ key: "P", label: "Population" }, { key: "Co", label: "Concept" }, { key: "Cx", label: "Context" }] },
  ECLIPSE: { label: "ECLIPSE", full: "Expectation · Client · Location · Impact · Professionals · Service", tag: "Policy & service", blurb: "Purpose-built for health policy and service management.", buckets: [{ key: "E", label: "Expectation" }, { key: "C", label: "Client group" }, { key: "L", label: "Location" }, { key: "I", label: "Impact" }, { key: "P", label: "Professionals" }, { key: "S", label: "Service" }] },
  PIRD:    { label: "PIRD",    full: "Population · Index test · Reference standard · Diagnosis", tag: "Diagnostic accuracy", blurb: "For diagnostic test accuracy reviews.", buckets: [{ key: "P", label: "Population" }, { key: "I", label: "Index test" }, { key: "R", label: "Reference standard" }, { key: "D", label: "Diagnosis" }] },
  Custom:  { label: "Custom",  full: "Build your own concept groups", tag: "Flexible", blurb: "Define your own buckets (1–6).", buckets: [{ key: "c1", label: "Concept 1" }, { key: "c2", label: "Concept 2" }, { key: "c3", label: "Concept 3" }], custom: true },
};

// buckets: bucket key -> term labels placed in that bucket. Each term's type
// (keyword / vocab / assembled-query) is resolved by pool membership, same
// as the website's FrameworkBuilder.
export function buildFrameworkQuery(
  frameworkKey: string,
  buckets: Record<string, string[]>,
  pool: Pool,
  kwFields: KwFields,
  target: Source,
): string {
  const fw = FRAMEWORKS[frameworkKey];
  if (!fw) throw new Error(`Unknown framework "${frameworkKey}"`);
  const activeQueries = target === "eric" ? pool.ericQueries : target === "trials" ? pool.ctQueries : pool.queries;
  const vocabPool = target === "eric" ? pool.eric : pool.mesh;

  return fw.buckets.map(b => {
    const terms = buckets[b.key] ?? [];
    if (!terms.length) return null;
    const vocab = terms.filter(t => vocabPool.includes(t));
    const kw = terms.filter(t => pool.keywords.includes(t));
    const qs = terms.filter(t => activeQueries.includes(t));
    const parts: string[] = [];
    if (kw.length) {
      const inner = kw.map(t => kwTerm(t, kwFields, target)).join(" OR ");
      parts.push(kw.length > 1 ? `(${inner})` : inner);
    }
    if (vocab.length) {
      const inner = vocab.map(t => vocabTerm(t, target)).join(" OR ");
      parts.push(vocab.length > 1 ? `(${inner})` : inner);
    }
    qs.forEach(q => parts.push(`(${q})`));
    return parts.length ? `(${parts.join(" OR ")})` : null;
  }).filter((x): x is string => x !== null).join("\nAND ");
}
