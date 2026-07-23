import { createLimiter } from "./rate-limit.js";
import type { AdvField, Article, SearchResult } from "./types.js";

// ERIC (Dept. of Education) Solr-backed API. CORS *, no key, no doi field,
// no author-keyword field, no sort parameter. Thesaurus descriptors live in
// `subject`; the abstract lives in `description`.
const ERIC_BASE = "https://api.ies.ed.gov/eric/";
const ERIC_FIELDS = "id,title,author,source,publicationtype,publicationdateyear,description,subject,peerreviewed,url";
const limit = createLimiter();

async function ericFetch(params: string): Promise<Response> {
  await limit();
  return fetch(`${ERIC_BASE}?${params}&format=json`);
}

interface EricDoc {
  id?: string;
  title?: string | string[];
  source?: string;
  publicationdateyear?: number;
  author?: string[];
  subject?: string[];
  description?: string;
  publicationtype?: string[];
  url?: string;
  peerreviewed?: string;
}

function parseEricDoc(doc: EricDoc): Article {
  return {
    src: "eric",
    pmid: doc.id ?? "",
    title: (Array.isArray(doc.title) ? doc.title[0] : doc.title) ?? "Untitled",
    journal: doc.source ?? "",
    year: doc.publicationdateyear ? String(doc.publicationdateyear) : "",
    authors: (doc.author ?? []).slice(0, 4),
    mesh: [],
    eric: (doc.subject ?? []).map(s => s.trim()).filter(Boolean),
    keywords: [],
    doi: "",
    abstract: (doc.description ?? "").trim(),
    pubtypes: doc.publicationtype ?? [],
    url: doc.url ?? "",
    peerReviewed: doc.peerreviewed === "T",
  };
}

export async function ericSearch(term: string, page: number, pageSize: number): Promise<SearchResult> {
  const start = (page - 1) * pageSize;
  const r = await ericFetch(`search=${encodeURIComponent(term)}&fields=${ERIC_FIELDS}&rows=${pageSize}&start=${start}`);
  if (!r.ok) return { articles: [], total: 0, error: `ERIC returned HTTP ${r.status}` };
  const j = await r.json() as { error?: { msg?: string }; response?: { docs?: EricDoc[]; numFound?: number } };
  if (j.error) return { articles: [], total: 0, error: j.error.msg ?? "ERIC query error" };
  return { articles: (j.response?.docs ?? []).map(parseEricDoc), total: j.response?.numFound ?? 0 };
}

export async function ericAuthorSearch(name: string, page: number, pageSize: number): Promise<SearchResult> {
  return ericSearch(`author:"${name}"`, page, pageSize);
}

// EJ/ED accession numbers are reliable; titles are best-effort. The API has
// no doi field, so DOIs in pasted text can't be resolved here.
export async function ericLookup(text: string): Promise<{ articles: Article[]; error?: string }> {
  const found = new Set<string>();
  for (const m of text.matchAll(/\b(E[JD]\d{5,8})\b/gi)) found.add(m[1].toUpperCase());
  if (!found.size) {
    const lines = text.split(/\n+/).filter(l => l.trim().length > 40);
    for (const line of lines.slice(0, 10)) {
      const t = line.replace(/^\d+\.\s*/, "").split(/[.;]\s+\d{4}/)[0].trim().slice(0, 120);
      if (t.length < 15) continue;
      try {
        const r = await ericFetch(`search=${encodeURIComponent(`title:"${t.replace(/"/g, "")}"`)}&fields=id&rows=1`);
        const j = await r.json() as { response?: { docs?: EricDoc[] } };
        const id = j.response?.docs?.[0]?.id;
        if (id) found.add(id);
      } catch { /* best-effort title match; skip on failure */ }
    }
  }
  if (!found.size) return { articles: [], error: "No records found" };
  const idQuery = [...found].map(id => `id:${id}`).join(" OR ");
  const { articles } = await ericSearch(idQuery, 1, found.size);
  return { articles };
}

// Every fielded prefix the Solr endpoint accepts (verified 2026-07). Solr
// binds an unquoted field prefix to the FIRST token only, so multi-word
// values must be quoted — the opposite of the PubMed rule.
export const ERIC_ADV_FIELDS: AdvField[] = [
  { label: "All Fields", tag: "all" },
  { label: "Abstract", tag: "description" },
  { label: "Author", tag: "author" },
  { label: "Descriptor (subject)", tag: "subject" },
  { label: "Education Level", tag: "educationlevel" },
  { label: "ERIC ID", tag: "id" },
  { label: "ISSN", tag: "issn" },
  { label: "Language", tag: "language" },
  { label: "Peer Reviewed (T/F)", tag: "peerreviewed" },
  { label: "Publication Type", tag: "publicationtype" },
  { label: "Publisher", tag: "publisher" },
  { label: "Source (journal)", tag: "source" },
  { label: "Title", tag: "title" },
  { label: "Year", tag: "publicationdateyear" },
];

export const ericAssembleTerm = (field: string, value: string): string => {
  const t = value.trim();
  const passthrough = /^["([]/.test(t) || !/\s/.test(t);
  const v = passthrough ? t : `"${t}"`;
  return field === "all" ? v : `${field}:${v}`;
};

// Maps the pool's per-keyword PubMed field tags onto ERIC's fielded syntax so
// one curated pool can emit strings for either database.
export const ericKwTerm = (term: string, tag: string): string => {
  const q = `"${term}"`;
  if (tag === "ti") return `title:${q}`;
  if (tag === "ab") return `description:${q}`;
  if (tag === "all") return q;
  return `(title:${q} OR description:${q})`; // tiab and anything else
};
export const ericDescTerm = (t: string): string => `subject:"${t}"`;
