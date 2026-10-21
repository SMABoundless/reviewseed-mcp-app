// The optional NCBI_API_KEY is read once at module load, so this file sets it
// before importing pubmed.ts. node --test runs each file in its own process,
// so the key never leaks into the other suites.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { installMockFetch, esearchJson, efetchXml } from "../helpers/mock-fetch.js";

process.env.NCBI_API_KEY = " test-key ";
const { pubmedSearch } = await import("../../server/pubmed.js");
const mock = installMockFetch([
  { match: "esearch.fcgi", body: esearchJson(["1"]) },
  { match: "efetch.fcgi", body: efetchXml([{ pmid: "1" }]) },
]);
after(() => mock.restore());

test("every E-utilities call carries the trimmed key alongside tool and email", async () => {
  await pubmedSearch("asthma", 1, 10);
  assert.ok(mock.calls.length >= 2);
  for (const c of mock.calls) {
    const u = new URL(c.url);
    assert.equal(u.searchParams.get("api_key"), "test-key");
    assert.equal(u.searchParams.get("tool"), "ReviewSeedMCP");
  }
});
