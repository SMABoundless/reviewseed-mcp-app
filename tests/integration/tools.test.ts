// Tool-level integration: a real MCP client talking to the real server over
// InMemoryTransport, with all upstream HTTP stubbed. Deterministic and
// offline — no rate limits, no upstream flakiness.
import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, payload, type Harness } from "../helpers/harness.js";
import {
  installMockFetch, esearchJson, esearchErrorJson, efetchXml, ericJson, ctJson,
  type MockFetch,
} from "../helpers/mock-fetch.js";

let h: Harness;
let mock: MockFetch | undefined;

before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(() => { mock = undefined; });
afterEach(() => { mock?.restore(); });

const call = (name: string, args: Record<string, unknown> = {}) =>
  h.client.callTool({ name, arguments: args });

// ── Tool surface ────────────────────────────────────────────────────────────

test("exposes exactly the expected tool set", async () => {
  const { tools } = await h.client.listTools();
  assert.deepEqual(tools.map(t => t.name).sort(), [
    "reviewseed_advanced_search",
    "reviewseed_assemble_query",
    "reviewseed_author_search",
    "reviewseed_compare_queries",
    "reviewseed_lookup",
    "reviewseed_open",
    "reviewseed_search",
    "reviewseed_vocab_details",
    "reviewseed_vocab_search",
  ]);
});

test("open/search/lookup/advanced_search share one UI resourceUri; the rest are headless", async () => {
  const { tools } = await h.client.listTools();
  const uiFor = (n: string) => (tools.find(t => t.name === n) as any)?._meta?.ui?.resourceUri;
  const shared = ["reviewseed_open", "reviewseed_search", "reviewseed_lookup", "reviewseed_advanced_search"];
  for (const n of shared) {
    assert.equal(uiFor(n), "ui://reviewseed/mcp-app.html", `${n} should render into the shared panel`);
  }
  for (const n of ["reviewseed_assemble_query", "reviewseed_compare_queries", "reviewseed_vocab_search"]) {
    assert.equal(uiFor(n), undefined, `${n} is headless and should not claim the UI`);
  }
});

test("the UI resource declares the CSP + clipboard permissions the sandbox needs", async () => {
  const res = await h.client.readResource({ uri: "ui://reviewseed/mcp-app.html" });
  const meta = (res.contents[0] as any)._meta?.ui;
  assert.deepEqual(meta.csp.resourceDomains, ["https://fonts.googleapis.com", "https://fonts.gstatic.com"]);
  assert.deepEqual(meta.permissions, { clipboardWrite: {} });
});

// ── Search ──────────────────────────────────────────────────────────────────

test("pubmed search returns parsed articles with MeSH and keywords", async () => {
  mock = installMockFetch([
    { match: "esearch.fcgi", body: esearchJson(["111"], 42) },
    { match: "efetch.fcgi", body: efetchXml([{ pmid: "111", title: "Gabapentin trial", mesh: ["Neuralgia"], keywords: ["pain"] }]) },
  ]);
  const r = payload(await call("reviewseed_search", { source: "pubmed", query: "gabapentin" }));
  assert.equal(r.total, 42);
  assert.equal(r.articles[0].pmid, "111");
  assert.deepEqual(r.articles[0].mesh, ["Neuralgia"]);
  assert.deepEqual(r.articles[0].keywords, ["pain"]);
});

test("matchTerms annotates each result with why it matched", async () => {
  mock = installMockFetch([
    { match: "esearch.fcgi", body: esearchJson(["111"]) },
    { match: "efetch.fcgi", body: efetchXml([{ pmid: "111", title: "Gabapentin trial", mesh: ["Neuralgia"] }]) },
  ]);
  const r = payload(await call("reviewseed_search", {
    source: "pubmed", query: "x", matchTerms: ["Neuralgia", "Gabapentin", "absent-term"],
  }));
  assert.deepEqual(r.articles[0].matchedVia, ["Neuralgia", "Gabapentin"]);
});

test("an NCBI-side ERROR payload surfaces as a clean error, not a crash", async () => {
  mock = installMockFetch([{ match: "esearch.fcgi", body: esearchErrorJson("Search Backend failed") }]);
  const r = payload(await call("reviewseed_search", { source: "pubmed", query: "x" }));
  assert.equal(r.error, "Search Backend failed");
  assert.deepEqual(r.articles, []);
});

// The exact regression from the round-3 QA cycle: efetch returning a non-OK
// status used to reach DOMParser and throw "missing root element".
test("REGRESSION: a 429 on efetch reports the status, never 'missing root element'", async () => {
  mock = installMockFetch([
    { match: "esearch.fcgi", body: esearchJson(["111"]) },
    { match: "efetch.fcgi", sequence: [{ status: 429, body: "" }, { status: 429, body: "" }] },
  ]);
  const r = payload(await call("reviewseed_search", { source: "pubmed", query: "x" }));
  assert.match(r.error, /efetch HTTP 429/);
  assert.doesNotMatch(r.error, /missing root element/);
});

test("REGRESSION: a transient 429 is retried once and then succeeds", async () => {
  mock = installMockFetch([
    { match: "esearch.fcgi", body: esearchJson(["111"]) },
    { match: "efetch.fcgi", sequence: [
      { status: 429, body: "" },
      { status: 200, body: efetchXml([{ pmid: "111", title: "Recovered" }]) },
    ] },
  ]);
  const r = payload(await call("reviewseed_search", { source: "pubmed", query: "x" }));
  assert.equal(r.articles[0].title, "Recovered", "the retry's result should be used");
  assert.equal(mock.callsMatching("efetch.fcgi").length, 2, "expected exactly one retry");
});

test("eric search maps Solr docs into the shared article shape", async () => {
  mock = installMockFetch([{ match: "api.ies.ed.gov", body: ericJson([
    { id: "EJ123", title: "Reading study", author: ["Smith, J"], subject: ["Reading Comprehension"], description: "Abstract.", publicationdateyear: 2023, peerreviewed: "T" },
  ], 7) }]);
  const r = payload(await call("reviewseed_search", { source: "eric", query: "reading" }));
  assert.equal(r.total, 7);
  assert.equal(r.articles[0].pmid, "EJ123");
  assert.deepEqual(r.articles[0].eric, ["Reading Comprehension"]);
  assert.equal(r.articles[0].peerReviewed, true);
});

test("trials search maps v2 studies and lifts MeSH-derived terms into the shared pool", async () => {
  mock = installMockFetch([{ match: "clinicaltrials.gov", body: ctJson([
    { nctId: "NCT01234567", title: "Asthma trial", mesh: ["Asthma"] },
  ], 3) }]);
  const r = payload(await call("reviewseed_search", { source: "trials", query: "asthma" }));
  assert.equal(r.total, 3);
  assert.equal(r.articles[0].pmid, "NCT01234567");
  assert.deepEqual(r.articles[0].mesh, ["Asthma"]);
  assert.equal(r.articles[0].ctStatus, "Recruiting");
});

// ── Lookup ──────────────────────────────────────────────────────────────────

test("lookup resolves a pasted PMID", async () => {
  mock = installMockFetch([
    { match: "efetch.fcgi", body: efetchXml([{ pmid: "30567716", title: "Pasted article" }]) },
  ]);
  const r = payload(await call("reviewseed_lookup", { source: "pubmed", text: "PMID: 30567716" }));
  assert.equal(r.articles[0].pmid, "30567716");
});

test("lookup reports a clean message when nothing resolves", async () => {
  mock = installMockFetch([{ match: "eutils", body: esearchJson([]) }]);
  const r = payload(await call("reviewseed_lookup", { source: "pubmed", text: "nothing identifiable" }));
  assert.equal(r.error, "No articles found");
});

// ── Advanced search ─────────────────────────────────────────────────────────

test("advanced_search with no rows lists that source's field options", async () => {
  const r = payload(await call("reviewseed_advanced_search", { source: "eric", rows: [] }));
  assert.ok(r.fields.some((f: any) => f.tag === "subject"), "ERIC should offer the subject field");
  assert.ok(!r.fields.some((f: any) => f.tag === "mh"), "ERIC must not offer PubMed's MeSH tag");
});

test("advanced_search assembles per-source syntax without running when run:false", async () => {
  const pm = payload(await call("reviewseed_advanced_search", {
    source: "pubmed", run: false,
    rows: [{ field: "au", value: "Hazan C" }, { field: "ti", value: "attachment", op: "AND" }],
  }));
  assert.equal(pm.query, '"Hazan C"[au] AND "attachment"[ti]');

  const ct = payload(await call("reviewseed_advanced_search", {
    source: "trials", run: false, rows: [{ field: "ConditionSearch", value: "heart failure" }],
  }));
  assert.equal(ct.query, 'AREA[ConditionSearch]"heart failure"');
});

// ── Assemble query (headless) ───────────────────────────────────────────────

test("assemble_query builds a boolean string with no UI and no network", async () => {
  const r = payload(await call("reviewseed_assemble_query", {
    source: "pubmed", mode: "boolean",
    pool: { keywords: ["gabapentin"], mesh: ["Neuralgia"], eric: [], queries: [], ericQueries: [], ctQueries: [] },
  }));
  assert.equal(r.query, '"gabapentin"[tiab] AND "Neuralgia"[MeSH Terms]');
});

test("assemble_query in framework mode with no key lists all ten frameworks plus Custom", async () => {
  const r = payload(await call("reviewseed_assemble_query", {
    source: "pubmed", mode: "framework",
    pool: { keywords: [], mesh: [], eric: [], queries: [], ericQueries: [], ctQueries: [] },
  }));
  assert.equal(Object.keys(r.frameworks).length, 11);
  assert.ok(r.frameworks.PICO.buckets.length === 4);
});

// ── Compare queries ─────────────────────────────────────────────────────────

test("compare_queries reports per-variant totals and sample-unique ids", async () => {
  mock = installMockFetch([
    { match: "esearch.fcgi", sequence: [esearchJson(["1", "2"], 100), esearchJson(["2", "3"], 500)].map(body => ({ body })) },
    { match: "efetch.fcgi", sequence: [
      { body: efetchXml([{ pmid: "1" }, { pmid: "2" }]) },
      { body: efetchXml([{ pmid: "2" }, { pmid: "3" }]) },
    ] },
  ]);
  const r = payload(await call("reviewseed_compare_queries", {
    source: "pubmed",
    queries: [{ label: "tight", query: "a" }, { label: "broad", query: "b" }],
  }));
  assert.equal(r.comparison[0].total, 100);
  assert.equal(r.comparison[1].total, 500);
  assert.deepEqual(r.comparison[0].uniqueToThisVariant, ["1"], "id 2 is shared, so only 1 is unique");
  assert.deepEqual(r.comparison[1].uniqueToThisVariant, ["3"]);
});

test("REGRESSION: one failing variant does not blank out the others", async () => {
  mock = installMockFetch([
    { match: "esearch.fcgi", sequence: [
      { body: esearchJson(["1"], 10) },
      { status: 500, body: "" },
      { status: 500, body: "" },
    ] },
    { match: "efetch.fcgi", body: efetchXml([{ pmid: "1", title: "Survivor" }]) },
  ]);
  const r = payload(await call("reviewseed_compare_queries", {
    source: "pubmed",
    queries: [{ label: "ok", query: "a" }, { label: "doomed", query: "b" }],
  }));
  assert.equal(r.comparison[0].total, 10, "the healthy variant must still report data");
  assert.ok(r.comparison[1].error, "the failing variant should carry an error");
  assert.equal(r.comparison.length, 2);
});

test("REGRESSION: variants run sequentially, not concurrently", async () => {
  const startedAt: number[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    if (url.includes("esearch.fcgi")) {
      startedAt.push(Date.now());
      await new Promise(r => setTimeout(r, 25)); // simulate upstream latency
      return new Response(esearchJson([]), { status: 200 });
    }
    return new Response("", { status: 200 });
  }) as typeof fetch;
  try {
    await call("reviewseed_compare_queries", {
      source: "pubmed",
      queries: [{ label: "a", query: "a" }, { label: "b", query: "b" }, { label: "c", query: "c" }],
    });
    assert.equal(startedAt.length, 3);
    // Concurrent dispatch would start all three within a few ms of each other.
    for (let i = 1; i < startedAt.length; i++) {
      assert.ok(
        startedAt[i] - startedAt[i - 1] >= 20,
        `variant ${i} started ${startedAt[i] - startedAt[i - 1]}ms after the previous — looks concurrent`,
      );
    }
  } finally {
    globalThis.fetch = original;
  }
});

// ── Vocabulary ──────────────────────────────────────────────────────────────

test("vocab_search over the ERIC thesaurus needs no network and reports the USE cross-reference", async () => {
  const r = payload(await call("reviewseed_vocab_search", { vocab: "eric", query: "gifted students" }));
  const hit = r.rows.find((x: any) => x.label === "Academically Gifted");
  assert.ok(hit);
  assert.equal(hit.via, "Gifted Students");
});

test("vocab_details returns ERIC Use-For synonyms and hierarchy", async () => {
  const r = payload(await call("reviewseed_vocab_details", { vocab: "eric", label: "Academically Gifted" }));
  assert.ok(r.terms.includes("Gifted Students"));
  assert.ok(r.bt.includes("Gifted"));
});

test("mesh vocab_search resolves an entry term to its descriptor via SPARQL", async () => {
  mock = installMockFetch([
    { match: "/mesh/lookup/descriptor", body: "[]" },
    { match: "/mesh/lookup/term", body: JSON.stringify([{ resource: "http://id.nlm.nih.gov/mesh/T012345", label: "Heart Attack" }]) },
    { match: "/mesh/sparql", body: JSON.stringify({ results: { bindings: [
      { t: { value: "http://id.nlm.nih.gov/mesh/T012345" }, d: { value: "http://id.nlm.nih.gov/mesh/D009203" }, dl: { value: "Myocardial Infarction" } },
    ] } }) },
  ]);
  const r = payload(await call("reviewseed_vocab_search", { vocab: "mesh", query: "heart attack" }));
  assert.equal(r.rows[0].label, "Myocardial Infarction");
  assert.equal(r.rows[0].via, "Heart Attack");
  assert.equal(r.rows[0].id, "D009203");
});

// ── Author search ───────────────────────────────────────────────────────────

test("author_search uses each source's own author syntax", async () => {
  mock = installMockFetch([
    { match: "esearch.fcgi", body: esearchJson([]) },
    { match: "api.ies.ed.gov", body: ericJson([]) },
    { match: "clinicaltrials.gov", body: ctJson([]) },
  ]);
  await call("reviewseed_author_search", { source: "pubmed", name: "Hazan C" });
  assert.ok(decodeURIComponent(mock.callsMatching("esearch.fcgi")[0].url).includes('"Hazan C"[au]'));

  await call("reviewseed_author_search", { source: "eric", name: "Smith J" });
  assert.ok(decodeURIComponent(mock.callsMatching("api.ies.ed.gov")[0].url).includes('author:"Smith J"'));

  await call("reviewseed_author_search", { source: "trials", name: "Doe J" });
  assert.ok(decodeURIComponent(mock.callsMatching("clinicaltrials.gov")[0].url).includes('AREA[OverallOfficialName]"Doe J"'));
});
