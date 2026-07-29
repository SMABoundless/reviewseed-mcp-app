// Shared plumbing for the MeSH vocabulary-fetcher parity fixtures.
//
// The fetchers call the bare global `fetch`, so routing canned NLM payloads by
// URL substring is enough to exercise them offline. Both the generator
// (tests/scripts/gen-vocab-expected.ts) and the test (tests/unit/
// vocab-parity.test.ts) drive them through here, so a case can never be
// generated one way and asserted another.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { meshVocabDetails, meshVocabSearch } from "../../server/mesh.js";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
export const VOCAB_INPUTS_PATH = path.join(DIR, "vocab-inputs.json");
export const VOCAB_EXPECTED_PATH = path.join(DIR, "vocab-expected.json");

export interface VocabRoute { urlContains: string; body: unknown }
export interface VocabCase {
  name: string;
  fn: "meshVocabSearch" | "meshVocabDetails";
  arg?: string;
  label?: string;
  id?: string | null;
  routes: VocabRoute[];
}
export interface VocabInputs { version: number; cases: VocabCase[] }

export const loadVocabInputs = (): VocabInputs =>
  JSON.parse(fs.readFileSync(VOCAB_INPUTS_PATH, "utf-8")) as VocabInputs;

export const loadVocabExpected = (): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(VOCAB_EXPECTED_PATH, "utf-8")) as Record<string, unknown>;

/**
 * Run one case against this repo's fetchers with `fetch` routed to its canned
 * payloads. An unmatched URL throws rather than returning empty — a fetcher
 * quietly asking for something the fixture doesn't describe would otherwise
 * look like a passing case with a suspiciously empty result.
 */
export async function runVocabCase(c: VocabCase): Promise<unknown> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input);
    const route = c.routes.find(r => url.includes(r.urlContains));
    if (!route) throw new Error(`vocab fixture "${c.name}": no route for ${url}`);
    return new Response(JSON.stringify(route.body), { status: 200 });
  }) as typeof fetch;
  try {
    return c.fn === "meshVocabSearch"
      ? await meshVocabSearch(c.arg ?? "")
      : await meshVocabDetails(c.label ?? "", c.id ?? undefined);
  } finally {
    globalThis.fetch = original;
  }
}

export async function buildVocabExpected(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const c of loadVocabInputs().cases) out[c.name] = await runVocabCase(c);
  return out;
}
