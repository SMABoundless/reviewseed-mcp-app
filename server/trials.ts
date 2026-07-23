import { createLimiter } from "./rate-limit.js";
import type { AdvField, Article, SearchResult } from "./types.js";

// ClinicalTrials.gov v2 API. CORS *, no key. Registry records carry
// MeSH-DERIVED terms (derivedSection.*BrowseModule.meshes) — harvested
// trials vocabulary lands in the same MeSH pool as PubMed's, since registry
// searching is a required systematic-review step (PRISMA/Cochrane).
const CT_BASE = "https://clinicaltrials.gov/api/v2/studies";
const CT_FIELDS = "NCTId,BriefTitle,OverallStatus,StartDate,LeadSponsorName,Condition,Keyword,BriefSummary,StudyType,Phase,HasResults,ConditionMeshTerm,InterventionMeshTerm,OverallOfficialName";
const limit = createLimiter();
const MAX_PAGES = 5;

async function ctFetch(params: string): Promise<Response> {
  await limit();
  return fetch(`${CT_BASE}?${params}`);
}

const CT_STATUS_LABELS: Record<string, string> = {
  RECRUITING: "Recruiting", NOT_YET_RECRUITING: "Not yet recruiting", ENROLLING_BY_INVITATION: "Enrolling by invitation",
  ACTIVE_NOT_RECRUITING: "Active, not recruiting", COMPLETED: "Completed", TERMINATED: "Terminated",
  SUSPENDED: "Suspended", WITHDRAWN: "Withdrawn", UNKNOWN: "Unknown status", AVAILABLE: "Available",
};

function parseCtStudy(st: any): Article {
  const ps = st.protocolSection ?? {};
  const idm = ps.identificationModule ?? {};
  const meshes = [
    ...((st.derivedSection?.conditionBrowseModule?.meshes) ?? []),
    ...((st.derivedSection?.interventionBrowseModule?.meshes) ?? []),
  ].map((m: any) => m.term).filter(Boolean);
  const kws = [...new Set<string>([
    ...((ps.conditionsModule?.keywords) ?? []),
    ...((ps.conditionsModule?.conditions) ?? []),
  ])].map((k: string) => k.trim()).filter(Boolean);
  const phases = ((ps.designModule?.phases ?? []) as string[]).filter(x => x && x !== "NA")
    .map(x => x.replace("PHASE", "Phase ").replace("EARLY_", "Early "));
  return {
    src: "trials",
    pmid: idm.nctId ?? "",
    title: idm.briefTitle ?? "Untitled study",
    journal: ps.sponsorCollaboratorsModule?.leadSponsor?.name ?? "",
    year: (ps.statusModule?.startDateStruct?.date ?? "").slice(0, 4),
    authors: ((ps.contactsLocationsModule?.overallOfficials ?? []) as any[]).slice(0, 4).map(o => o.name).filter(Boolean),
    mesh: [...new Set<string>(meshes)],
    eric: [],
    keywords: kws,
    doi: "",
    abstract: (ps.descriptionModule?.briefSummary ?? "").trim(),
    pubtypes: [ps.designModule?.studyType, ...phases].filter(Boolean),
    url: idm.nctId ? `https://clinicaltrials.gov/study/${idm.nctId}` : "",
    ctStatus: CT_STATUS_LABELS[ps.statusModule?.overallStatus] ?? "",
    hasResults: !!st.hasResults,
  };
}

// Pagination is forward-only (token-based). Cache the token needed to reach
// page N+1 from page N, keyed by search term, so repeated tool calls for
// later pages of the same search don't have to re-walk from page 1 — same
// approach as the website's per-search token cache.
const pageTokenCache = new Map<string, string>(); // `${term}::${page}` -> token to fetch that page

async function fetchPage(term: string, pageToken?: string): Promise<{ articles: Article[]; total: number; nextPageToken: string | null; error?: string }> {
  let params = `query.term=${encodeURIComponent(term)}&fields=${CT_FIELDS}&pageSize=10&countTotal=true`;
  if (pageToken) params += `&pageToken=${encodeURIComponent(pageToken)}`;
  const r = await ctFetch(params);
  if (!r.ok) {
    let msg = `ClinicalTrials.gov returned HTTP ${r.status}`;
    try { const j = await r.json() as { message?: string }; if (j.message) msg = j.message; } catch { /* keep default msg */ }
    return { articles: [], total: 0, nextPageToken: null, error: msg };
  }
  const j = await r.json() as { studies?: any[]; totalCount?: number; nextPageToken?: string };
  return { articles: (j.studies ?? []).map(parseCtStudy), total: j.totalCount ?? 0, nextPageToken: j.nextPageToken ?? null };
}

export async function ctSearch(term: string, page: number): Promise<SearchResult> {
  page = Math.min(page, MAX_PAGES);
  if (page === 1) {
    const r = await fetchPage(term);
    if (r.nextPageToken) pageTokenCache.set(`${term}::1`, r.nextPageToken);
    return { articles: r.articles, total: r.total, error: r.error, nextPageToken: r.nextPageToken };
  }
  let token = pageTokenCache.get(`${term}::${page - 1}`);
  if (!token) {
    // Walk forward from page 1, caching each hop, until we reach the requested page.
    let cursor = 1;
    let r = await fetchPage(term);
    if (r.nextPageToken) pageTokenCache.set(`${term}::1`, r.nextPageToken);
    while (cursor < page - 1) {
      if (!r.nextPageToken) return { articles: [], total: r.total, error: "No further pages" };
      cursor++;
      r = await fetchPage(term, r.nextPageToken);
      if (r.nextPageToken) pageTokenCache.set(`${term}::${cursor}`, r.nextPageToken);
    }
    token = pageTokenCache.get(`${term}::${page - 1}`);
  }
  const r = await fetchPage(term, token);
  if (r.nextPageToken) pageTokenCache.set(`${term}::${page}`, r.nextPageToken);
  return { articles: r.articles, total: r.total, error: r.error, nextPageToken: r.nextPageToken };
}

export async function ctAuthorSearch(name: string): Promise<SearchResult> {
  return ctSearch(`AREA[OverallOfficialName]"${name}"`, 1);
}

// NCT accession numbers are exact; titles are best-effort.
export async function ctLookup(text: string): Promise<{ articles: Article[]; error?: string }> {
  const found = new Set<string>();
  for (const m of text.matchAll(/\b(NCT\d{8})\b/gi)) found.add(m[1].toUpperCase());
  if (!found.size) {
    const lines = text.split(/\n+/).filter(l => l.trim().length > 40);
    for (const line of lines.slice(0, 10)) {
      const t = line.replace(/^\d+\.\s*/, "").trim().slice(0, 120);
      if (t.length < 15) continue;
      try {
        const r = await ctFetch(`query.titles=${encodeURIComponent('"' + t.replace(/"/g, "") + '"')}&fields=NCTId&pageSize=1`);
        const j = await r.json() as { studies?: any[] };
        const id = j.studies?.[0]?.protocolSection?.identificationModule?.nctId;
        if (id) found.add(id);
      } catch { /* best-effort title match; skip on failure */ }
    }
  }
  if (!found.size) return { articles: [], error: "No studies found" };
  const r = await ctFetch(`filter.ids=${[...found].join(",")}&fields=${CT_FIELDS}&pageSize=${Math.min(found.size, 50)}`);
  const j = await r.json() as { studies?: any[] };
  return { articles: (j.studies ?? []).map(parseCtStudy) };
}

// Each maps to a verified Essie AREA[] operator.
export const CT_ADV_FIELDS: AdvField[] = [
  { label: "All terms", tag: "all" },
  { label: "Condition / disease", tag: "ConditionSearch" },
  { label: "Intervention / treatment", tag: "InterventionSearch" },
  { label: "Location", tag: "LocationSearch" },
  { label: "Outcome measure", tag: "OutcomeSearch" },
  { label: "Investigator (official)", tag: "OverallOfficialName" },
  { label: "Phase (PHASE1…PHASE4)", tag: "Phase" },
  { label: "Sponsor (lead)", tag: "LeadSponsorName" },
  { label: "Status (e.g. RECRUITING)", tag: "OverallStatus" },
  { label: "Title", tag: "BriefTitle" },
];

export const ctAssembleTerm = (field: string, value: string): string => {
  const t = value.trim();
  const passthrough = /^["([]/.test(t) || !/\s/.test(t);
  const v = passthrough ? t : `"${t}"`;
  return field === "all" ? v : `AREA[${field}]${v}`;
};

// Essie's default weighted search already spans title/summary/conditions, so
// only an explicit Title tag narrows; MeSH terms probe the trial's indexed
// condition AND intervention vocabularies.
export const ctKwTerm = (term: string, tag: string): string => tag === "ti" ? `AREA[BriefTitle]"${term}"` : `"${term}"`;
export const ctMeshTerm = (t: string): string => `(AREA[ConditionSearch]"${t}" OR AREA[InterventionSearch]"${t}")`;
