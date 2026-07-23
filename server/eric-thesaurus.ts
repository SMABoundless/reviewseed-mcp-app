import fs from "node:fs/promises";
import path from "node:path";
import type { VocabDetails, VocabRow } from "./types.js";

export const ERIC_THESAURUS_EDITION = "2025";
const ASSET_PATH = path.join(import.meta.dirname, "assets", "eric-thesaurus-2025.json");

interface ThesaurusEntry { u?: string[]; b?: string[]; n?: string[] } // Use-For, broader, narrower
type ThesaurusMap = Record<string, ThesaurusEntry>;

let thesaurusPromise: Promise<ThesaurusMap | null> | null = null;
function loadThesaurus(): Promise<ThesaurusMap | null> {
  if (!thesaurusPromise) {
    thesaurusPromise = fs.readFile(ASSET_PATH, "utf-8")
      .then(text => JSON.parse(text) as ThesaurusMap)
      .catch(() => { thesaurusPromise = null; return null; });
  }
  return thesaurusPromise;
}

interface RevIndex { canon: string[]; syn: Array<{ syn: string; descriptor: string }> }
let revIndex: RevIndex | null = null;
async function buildRevIndex(): Promise<RevIndex | null> {
  if (revIndex) return revIndex;
  const map = await loadThesaurus();
  if (!map) return null;
  const canon = Object.keys(map);
  const syn: Array<{ syn: string; descriptor: string }> = [];
  canon.forEach(d => (map[d].u ?? []).forEach(u => syn.push({ syn: u, descriptor: d })));
  revIndex = { canon, syn };
  return revIndex;
}

// Searches the shipped Use-For/broader/narrower snapshot (ERIC's API has no
// thesaurus endpoint). Rows carry `via` = the Use-For synonym that matched
// ("gifted students" → "Academically Gifted"), ranked: exact-canonical,
// canonical-substring, then synonym matches.
export async function ericThesaurusSearch(q: string): Promise<VocabRow[] | undefined> {
  const clean = q.trim().toLowerCase();
  if (clean.length < 2) return [];
  const idx = await buildRevIndex();
  if (!idx) return undefined; // asset failed to load
  const byDesc = new Map<string, { label: string; via: string | null; rank: number }>();
  const consider = (descriptor: string, via: string | null, rank: number) => {
    const cur = byDesc.get(descriptor);
    if (!cur || rank < cur.rank) byDesc.set(descriptor, { label: descriptor, via, rank });
  };
  idx.canon.forEach(d => {
    const dl = d.toLowerCase();
    if (dl === clean) consider(d, null, 0);
    else if (dl.includes(clean)) consider(d, null, 1);
  });
  idx.syn.forEach(({ syn, descriptor }) => {
    if (syn.toLowerCase().includes(clean)) consider(descriptor, syn, 2);
  });
  return [...byDesc.values()]
    .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label))
    .slice(0, 30)
    .map(({ label, via }) => ({ label, via }));
}

export async function ericThesaurusDetails(label: string): Promise<VocabDetails | undefined> {
  const map = await loadThesaurus();
  if (!map) return undefined; // asset failed to load
  const key = map[label] ? label : Object.keys(map).find(k => k.toLowerCase() === label.trim().toLowerCase());
  const hit = key ? map[key] : null;
  return { terms: hit?.u ?? [], bt: hit?.b ?? [], nt: hit?.n ?? [], scopeNote: "" };
}
