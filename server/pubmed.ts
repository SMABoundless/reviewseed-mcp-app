import { DOMParser } from "@xmldom/xmldom";
import { createLimiter } from "./rate-limit.js";
import type { AdvField, Article, SearchResult } from "./types.js";

const PUBMED_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
// NCBI E-utilities policy requires `tool` and `email` so abusive traffic can
// be traced back to a maintainer instead of the IP getting cold-blocked.
const NCBI_TOOL_PARAMS = `tool=ReviewSeedMCP&email=${encodeURIComponent("smadams@northwestern.edu")}`;
const limit = createLimiter();

async function ncbiFetch(url: string): Promise<Response> {
  await limit();
  const sep = url.includes("?") ? "&" : "?";
  return fetch(url + sep + NCBI_TOOL_PARAMS);
}

const stripTags = (s: string) => (s || "").replace(/<[^>]+>/g, "");

async function esearch(term: string, retstart = 0, retmax = 10): Promise<{ ids: string[]; total: number; error?: string }> {
  const params = `db=pubmed&retmode=json&retmax=${retmax}&retstart=${retstart}&term=${encodeURIComponent(term)}&sort=relevance`;
  const r = await ncbiFetch(`${PUBMED_BASE}/esearch.fcgi?${params}`);
  if (!r.ok) throw new Error(`esearch HTTP ${r.status}`);
  // NCBI sometimes returns a 200 with an ERROR string containing a literal
  // newline (e.g. during backend outages) — that breaks JSON.parse, so parse
  // manually and regex-extract the message on failure.
  const text = await r.text();
  try {
    const j = JSON.parse(text) as { esearchresult?: { idlist?: string[]; count?: string; ERROR?: string } };
    if (j.esearchresult?.ERROR) return { ids: [], total: 0, error: j.esearchresult.ERROR };
    return { ids: j.esearchresult?.idlist ?? [], total: parseInt(j.esearchresult?.count ?? "0", 10) };
  } catch {
    const m = text.match(/"ERROR"\s*:\s*"([^"\n\r]+)/);
    return { ids: [], total: 0, error: m ? m[1].replace(/\\$/, "").trim() : "malformed response from NCBI" };
  }
}

async function efetchXml(pmids: string[]): Promise<Record<string, Article>> {
  if (!pmids.length) return {};
  const r = await ncbiFetch(`${PUBMED_BASE}/efetch.fcgi?db=pubmed&id=${pmids.join(",")}&rettype=xml&retmode=xml`);
  const xml = await r.text();
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const out: Record<string, Article> = {};
  const articles = doc.getElementsByTagName("PubmedArticle");
  for (let i = 0; i < articles.length; i++) {
    const art = articles[i];
    const pmid = art.getElementsByTagName("PMID")[0]?.textContent?.trim();
    if (!pmid) continue;
    const title = stripTags(art.getElementsByTagName("ArticleTitle")[0]?.textContent ?? "").trim();
    const journal = art.getElementsByTagName("ISOAbbreviation")[0]?.textContent?.trim() ?? "";
    const year = art.getElementsByTagName("PubDate")[0]?.getElementsByTagName("Year")[0]?.textContent
      ?? art.getElementsByTagName("MedlineDate")[0]?.textContent?.slice(0, 4) ?? "";
    const authorEls = art.getElementsByTagName("Author");
    const authors: string[] = [];
    for (let j = 0; j < Math.min(authorEls.length, 4); j++) {
      const last = authorEls[j].getElementsByTagName("LastName")[0]?.textContent ?? "";
      const init = authorEls[j].getElementsByTagName("Initials")[0]?.textContent ?? "";
      const name = [last, init].filter(Boolean).join(" ");
      if (name) authors.push(name);
    }
    const mesh: string[] = [];
    const descriptors = art.getElementsByTagName("DescriptorName");
    for (let j = 0; j < descriptors.length; j++) {
      const t = descriptors[j].textContent?.trim();
      if (t) mesh.push(t);
    }
    const keywords: string[] = [];
    const kwEls = art.getElementsByTagName("Keyword");
    for (let j = 0; j < kwEls.length; j++) {
      const t = kwEls[j].textContent?.trim();
      if (t && t.length > 1) keywords.push(t);
    }
    const idEls = art.getElementsByTagName("ArticleId");
    let doi = "";
    for (let j = 0; j < idEls.length; j++) {
      if (idEls[j].getAttribute("IdType") === "doi") { doi = idEls[j].textContent?.trim() ?? ""; break; }
    }
    const abstractEls = art.getElementsByTagName("AbstractText");
    let abstractText = "";
    for (let j = 0; j < abstractEls.length; j++) abstractText += (abstractEls[j].textContent ?? "") + " ";
    const pubtypes: string[] = [];
    const ptEls = art.getElementsByTagName("PublicationType");
    for (let j = 0; j < ptEls.length; j++) { const t = ptEls[j].textContent?.trim(); if (t) pubtypes.push(t); }

    out[pmid] = {
      src: "pubmed", pmid, doi, title: title || "Untitled",
      authors, year: (year ?? "").match(/\d{4}/)?.[0] ?? "", journal,
      keywords: [...new Set(keywords)], mesh: [...new Set(mesh)], eric: [],
      abstract: stripTags(abstractText).trim(), pubtypes,
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    };
  }
  return out;
}

export async function pubmedSearch(term: string, page: number, pageSize: number): Promise<SearchResult> {
  const retstart = (page - 1) * pageSize;
  const r = await esearch(term, retstart, pageSize);
  if (r.error) return { articles: [], total: 0, error: r.error };
  if (!r.ids.length) return { articles: [], total: r.total };
  const details = await efetchXml(r.ids);
  return { articles: r.ids.map(id => details[id]).filter(Boolean), total: r.total };
}

export async function pubmedFetchByIds(ids: string[]): Promise<Article[]> {
  const details = await efetchXml(ids);
  return ids.map(id => details[id]).filter(Boolean);
}

export async function pubmedEsearchIds(term: string, retmax: number, retstart = 0): Promise<string[]> {
  const r = await esearch(term, retstart, retmax);
  return r.ids;
}

// PMIDs are exact; DOIs resolve via esearch's [doi] field; titles are
// best-effort fallback via [Title].
export async function pubmedLookup(text: string): Promise<{ articles: Article[]; error?: string }> {
  const found = new Set<string>();
  for (const m of text.matchAll(/(?:PMID|pmid)[:\s]*(\d{7,8})/g)) found.add(m[1]);
  for (const m of text.matchAll(/^\s*(\d{7,8})\s*$/gm)) found.add(m[1]);
  for (const m of text.matchAll(/10\.\d{4,}\/\S+/g)) {
    const ids = await pubmedEsearchIds(`${m[0]}[doi]`, 1);
    if (ids[0]) found.add(ids[0]);
  }
  if (!found.size) {
    const lines = text.split(/\n+/).filter(l => l.trim().length > 40);
    for (const line of lines.slice(0, 10)) {
      const t = line.replace(/^\d+\.\s*/, "").split(/[.;]\s+\d{4}/)[0].trim().slice(0, 120);
      if (t.length < 15) continue;
      const ids = await pubmedEsearchIds(`${t}[Title]`, 1);
      if (ids[0]) found.add(ids[0]);
    }
  }
  if (!found.size) return { articles: [], error: "No articles found" };
  return { articles: await pubmedFetchByIds([...found]) };
}

export async function pubmedAuthorSearch(name: string, page: number, pageSize: number): Promise<SearchResult> {
  return pubmedSearch(`"${name}"[au]`, page, pageSize);
}

// Mirrors pubmed.ncbi.nlm.nih.gov/advanced/ — same options, same labels,
// same alphabetical order. Tags are E-utilities' short bracket-tag forms.
export const PUBMED_FIELDS: AdvField[] = [
  { label: "Affiliation", tag: "ad" },
  { label: "All Fields", tag: "all" },
  { label: "Author", tag: "au" },
  { label: "Author - Corporate", tag: "cn" },
  { label: "Author - First", tag: "1au" },
  { label: "Author - Identifier", tag: "auid" },
  { label: "Author - Last", tag: "lastau" },
  { label: "Book", tag: "book" },
  { label: "Conflict of Interest Statements", tag: "cois" },
  { label: "Date - Completion", tag: "dcom" },
  { label: "Date - Create", tag: "crdt" },
  { label: "Date - Entry", tag: "edat" },
  { label: "Date - MeSH", tag: "mhda" },
  { label: "Date - Modification", tag: "lr" },
  { label: "Date - Publication", tag: "dp" },
  { label: "EC/RN Number", tag: "rn" },
  { label: "Editor", tag: "ed" },
  { label: "Grants and Funding", tag: "gr" },
  { label: "ISBN", tag: "isbn" },
  { label: "Investigator", tag: "ir" },
  { label: "Issue", tag: "ip" },
  { label: "Journal", tag: "ta" },
  { label: "Language", tag: "la" },
  { label: "Location ID", tag: "lid" },
  { label: "MeSH Major Topic", tag: "majr" },
  { label: "MeSH Subheading", tag: "sh" },
  { label: "MeSH Terms", tag: "mh" },
  { label: "Other Term", tag: "ot" },
  { label: "Pagination", tag: "pg" },
  { label: "Pharmacological Action", tag: "pa" },
  { label: "Publication Type", tag: "pt" },
  { label: "Publisher", tag: "pubn" },
  { label: "Secondary Source ID", tag: "si" },
  { label: "Subject - Personal Name", tag: "ps" },
  { label: "Supplementary Concept", tag: "nm" },
  { label: "Text Word", tag: "tw" },
  { label: "Title", tag: "ti" },
  { label: "Title/Abstract", tag: "tiab" },
  { label: "Transliterated Title", tag: "tt" },
  { label: "Volume", tag: "vi" },
];

export const pubmedAssembleTerm = (field: string, value: string): string => {
  const t = value.trim();
  return field === "all" ? `"${t}"` : `"${t}"[${field}]`;
};
