import type { Article } from "./types.js";

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Whole-word/phrase match, not naive substring — otherwise a pool term like
// "pain" would falsely match "Spain" or "painful" in a title/abstract.
//
// Boundaries are applied per-edge rather than with a blanket \b: \b asserts a
// WORD boundary, which can never hold next to punctuation, so a term like
// "(+)-morphine" (PubMed author keywords are full of chemical names like this)
// would match nothing at all. Assert "not preceded/followed by a word char"
// only on edges that are themselves word chars — equivalent to \b there, and
// correctly unconstrained on punctuation edges.
function containsWholeWord(haystack: string, term: string): boolean {
  const left = /^\w/.test(term) ? "(?<!\\w)" : "";
  const right = /\w$/.test(term) ? "(?!\\w)" : "";
  return new RegExp(`${left}${escapeRegExp(term)}${right}`, "i").test(haystack);
}

// Which of the caller's own pool terms actually triggered a given result —
// otherwise, for an OR-heavy Boolean/framework query, the only way to know
// why a record matched is to cross-reference its full mesh/eric/keyword
// arrays by hand. Vocabulary terms (MeSH headings, ERIC descriptors, author
// keywords) match on exact (case-insensitive) membership; anything else is
// treated as a free-text keyword and checked as a whole-word/phrase match in
// the title or abstract, since a pooled keyword's `[tiab]`/`title:`/etc.
// field tag means it was searched as free text, not necessarily present in
// structured metadata fields.
export function matchedVia(article: Article, terms: string[]): string[] {
  const mesh = new Set(article.mesh.map(t => t.toLowerCase()));
  const eric = new Set(article.eric.map(t => t.toLowerCase()));
  const keywords = new Set(article.keywords.map(t => t.toLowerCase()));
  const haystack = `${article.title} ${article.abstract}`;
  return terms.filter(term => {
    const t = term.toLowerCase();
    return mesh.has(t) || eric.has(t) || keywords.has(t) || containsWholeWord(haystack, term);
  });
}

export function withMatchedVia<T extends Article>(articles: T[], terms?: string[]): Array<T & { matchedVia?: string[] }> {
  if (!terms?.length) return articles;
  return articles.map(a => ({ ...a, matchedVia: matchedVia(a, terms) }));
}
