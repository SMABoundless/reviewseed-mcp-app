// Deterministic fetch stubbing for the integration suite.
//
// Every adapter calls the bare global `fetch`, so swapping `globalThis.fetch`
// intercepts all upstream traffic without touching production code. This is
// what lets the suite assert on paths that are impossible to trigger reliably
// against live APIs — most importantly a 429, which is exactly the failure
// that produced the cryptic "missing root element" bug.

export interface MockCall { url: string; init?: RequestInit }

export interface MockRoute {
  /** Substring matched against the request URL. */
  match: string;
  status?: number;
  body?: string;
  /** Per-call bodies/statuses, consumed in order — for retry assertions. */
  sequence?: Array<{ status?: number; body?: string }>;
}

export interface MockFetch {
  calls: MockCall[];
  /** Calls whose URL contains the given substring. */
  callsMatching(substr: string): MockCall[];
  restore(): void;
}

export function installMockFetch(routes: MockRoute[]): MockFetch {
  const original = globalThis.fetch;
  const calls: MockCall[] = [];
  const cursors = new Map<MockRoute, number>();

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input);
    calls.push({ url, init });

    const route = routes.find(r => url.includes(r.match));
    if (!route) {
      throw new Error(
        `mock-fetch: no route matched ${url}\n` +
        `  configured: ${routes.map(r => r.match).join(", ") || "(none)"}`,
      );
    }

    let status = route.status ?? 200;
    let body = route.body ?? "";
    if (route.sequence?.length) {
      const i = cursors.get(route) ?? 0;
      const step = route.sequence[Math.min(i, route.sequence.length - 1)];
      cursors.set(route, i + 1);
      status = step.status ?? 200;
      body = step.body ?? "";
    }
    return new Response(body, { status });
  }) as typeof fetch;

  return {
    calls,
    callsMatching: (substr: string) => calls.filter(c => c.url.includes(substr)),
    restore: () => { globalThis.fetch = original; },
  };
}

// ── Canned upstream payloads ────────────────────────────────────────────────
export const esearchJson = (ids: string[], count = ids.length) =>
  JSON.stringify({ esearchresult: { idlist: ids, count: String(count) } });

export const esearchErrorJson = (msg: string) =>
  JSON.stringify({ esearchresult: { ERROR: msg } });

export const efetchXml = (articles: Array<{ pmid: string; title?: string; mesh?: string[]; keywords?: string[] }>) =>
  `<?xml version="1.0"?><PubmedArticleSet>${articles.map(a => `
    <PubmedArticle><MedlineCitation>
      <PMID>${a.pmid}</PMID>
      <Article>
        <Journal><ISOAbbreviation>J Test</ISOAbbreviation><JournalIssue><PubDate><Year>2024</Year></PubDate></JournalIssue></Journal>
        <ArticleTitle>${a.title ?? "Untitled"}</ArticleTitle>
        <AuthorList><Author><LastName>Doe</LastName><Initials>J</Initials></Author></AuthorList>
        <Abstract><AbstractText>Abstract text.</AbstractText></Abstract>
        <PublicationTypeList><PublicationType>Journal Article</PublicationType></PublicationTypeList>
      </Article>
      <MeshHeadingList>${(a.mesh ?? []).map(m => `<MeshHeading><DescriptorName>${m}</DescriptorName></MeshHeading>`).join("")}</MeshHeadingList>
      <KeywordList>${(a.keywords ?? []).map(k => `<Keyword>${k}</Keyword>`).join("")}</KeywordList>
    </MedlineCitation></PubmedArticle>`).join("")}</PubmedArticleSet>`;

export const ericJson = (docs: Array<Record<string, unknown>>, numFound = docs.length) =>
  JSON.stringify({ response: { docs, numFound } });

export const ctJson = (studies: Array<{ nctId: string; title?: string; mesh?: string[] }>, totalCount = studies.length) =>
  JSON.stringify({
    totalCount,
    studies: studies.map(s => ({
      protocolSection: {
        identificationModule: { nctId: s.nctId, briefTitle: s.title ?? "A study" },
        statusModule: { overallStatus: "RECRUITING", startDateStruct: { date: "2024-01-01" } },
        descriptionModule: { briefSummary: "Summary." },
        designModule: { studyType: "INTERVENTIONAL", phases: ["PHASE3"] },
        conditionsModule: { conditions: ["Asthma"], keywords: [] },
        sponsorCollaboratorsModule: { leadSponsor: { name: "Test Sponsor" } },
        contactsLocationsModule: { overallOfficials: [{ name: "Smith J" }] },
      },
      derivedSection: {
        conditionBrowseModule: { meshes: (s.mesh ?? []).map(term => ({ term })) },
        interventionBrowseModule: { meshes: [] },
      },
      hasResults: false,
    })),
  });
