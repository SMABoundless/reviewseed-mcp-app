// Regenerates tests/fixtures/parser-expected.json by running the canonical
// upstream payloads (parser-inputs.json) through THIS repo's parsers.
//
//   npm run snapshot
//
// Generating rather than hand-writing keeps the expectations honest about what
// the shared Article shape actually contains. The website then asserts its own
// parsers produce the same objects from the same bytes — any divergence is drift.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { efetchXml } from "../../server/pubmed.js";
import { parseEricDoc } from "../../server/eric.js";
import { parseCtStudy } from "../../server/trials.js";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const inputs = JSON.parse(fs.readFileSync(path.join(DIR, "parser-inputs.json"), "utf-8"));

// efetchXml fetches; hand it the canned XML rather than the network.
const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => new Response(inputs.efetchXml, { status: 200 })) as typeof fetch;
const pubmed = await efetchXml(inputs.efetchPmids);
globalThis.fetch = originalFetch;

const expected = {
  pubmed,
  eric: parseEricDoc(inputs.ericDoc),
  trials: parseCtStudy(inputs.ctStudy),
};

const out = path.join(DIR, "parser-expected.json");
fs.writeFileSync(out, JSON.stringify(expected, null, 2) + "\n");
console.log(`wrote ${out}`);
