import type { VocabDetails, VocabRow } from "./types.js";

const MESH_LOOKUP = "https://id.nlm.nih.gov/mesh/lookup/descriptor";
const MESH_SPARQL = "https://id.nlm.nih.gov/mesh/sparql";

async function sparql(query: string): Promise<{ results?: { bindings?: Record<string, { value: string }>[] } } | null> {
  try {
    const r = await fetch(`${MESH_SPARQL}?format=JSON&inference=false&query=${encodeURIComponent(query)}`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function meshHierarchy(id: string): Promise<{ bt: string[]; nt: string[] }> {
  const q = `PREFIX meshv: <http://id.nlm.nih.gov/mesh/vocab#> PREFIX mesh: <http://id.nlm.nih.gov/mesh/> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> SELECT ?dir ?label WHERE { { mesh:${id} meshv:broaderDescriptor ?d . BIND("b" AS ?dir) } UNION { ?d meshv:broaderDescriptor mesh:${id} . BIND("n" AS ?dir) } ?d rdfs:label ?label . } ORDER BY ?label`;
  const j = await sparql(q);
  const bt: string[] = [], nt: string[] = [];
  (j?.results?.bindings ?? []).forEach((x: any) => (x.dir.value === "b" ? bt : nt).push(x.label.value));
  return { bt, nt };
}

// Scope note (definition) for a descriptor id.
async function meshScopeNote(id: string): Promise<string> {
  const q = `PREFIX meshv: <http://id.nlm.nih.gov/mesh/vocab#> PREFIX mesh: <http://id.nlm.nih.gov/mesh/> SELECT ?note WHERE { mesh:${id} meshv:preferredConcept ?c . ?c meshv:scopeNote ?note }`;
  const j = await sparql(q);
  return (j?.results?.bindings?.[0] as any)?.note?.value ?? "";
}

async function meshEntryTerms(label: string): Promise<{ terms: string[]; bt: string[]; nt: string[] } | null> {
  const clean = label.trim();
  let r = await fetch(`${MESH_LOOKUP}?label=${encodeURIComponent(clean)}&match=exact&limit=1`);
  let j = r.ok ? await r.json() as Array<{ resource: string; label: string }> : [];
  if (!j.length) {
    r = await fetch(`${MESH_LOOKUP}?label=${encodeURIComponent(clean)}&match=contains&limit=10`);
    j = r.ok ? await r.json() as Array<{ resource: string; label: string }> : [];
    j = j.filter(d => d.label.toLowerCase() === clean.toLowerCase());
  }
  const id = j[0]?.resource?.split("/").pop();
  if (!id) return null;
  const [dr, hier] = await Promise.all([
    fetch(`https://id.nlm.nih.gov/mesh/lookup/details?descriptor=${encodeURIComponent(id)}`),
    meshHierarchy(id),
  ]);
  if (!dr.ok) return null;
  const det = await dr.json() as { terms?: Array<{ label: string }> };
  const seen = new Set([clean.toLowerCase()]);
  const terms = (det.terms ?? [])
    .map(t => t.label.trim())
    .filter(t => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
  return { terms, bt: hier.bt, nt: hier.nt };
}

// The plain descriptor lookup only matches heading LABELS — "heart attack"
// finds nothing. So also search the entry-term vocabulary via /lookup/term
// (which knows "Heart Attack") and resolve those term URIs back to
// descriptors in one batched SPARQL VALUES query. Rows carry `via` = the
// synonym that matched, giving the print-thesaurus cross-reference. Canonical
// (label) matches rank first.
export async function meshVocabSearch(q: string): Promise<VocabRow[]> {
  const clean = q.trim();
  if (clean.length < 2) return [];
  const enc = encodeURIComponent(clean);
  const [descR, termR] = await Promise.all([
    fetch(`${MESH_LOOKUP}?label=${enc}&match=contains&limit=25`).then(r => r.ok ? r.json() : []).catch(() => []),
    fetch(`https://id.nlm.nih.gov/mesh/lookup/term?label=${enc}&match=contains&limit=40`).then(r => r.ok ? r.json() : []).catch(() => []),
  ]) as [Array<{ resource: string; label: string }>, Array<{ resource: string; label: string }>];

  const rows: VocabRow[] = [];
  const byId = new Map<string, VocabRow>();
  (Array.isArray(descR) ? descR : []).forEach(d => {
    const id = (d.resource || "").split("/").pop();
    if (id && !byId.has(id)) { const row: VocabRow = { id, label: d.label, via: null }; byId.set(id, row); rows.push(row); }
  });

  const termUris = [...new Set((Array.isArray(termR) ? termR : []).map(t => (t.resource || "").split("/").pop()).filter((x): x is string => !!x))].slice(0, 30);
  const termLabel: Record<string, string> = {};
  (Array.isArray(termR) ? termR : []).forEach(t => { const id = (t.resource || "").split("/").pop(); if (id) termLabel[id] = t.label; });

  if (termUris.length) {
    const q2 = `PREFIX meshv: <http://id.nlm.nih.gov/mesh/vocab#> PREFIX mesh: <http://id.nlm.nih.gov/mesh/> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> SELECT ?t ?d ?dl WHERE { VALUES ?t { ${termUris.map(u => "mesh:" + u).join(" ")} } ?c meshv:term ?t . ?d ?p ?c . ?d a meshv:TopicalDescriptor ; rdfs:label ?dl . }`;
    const sj = await sparql(q2);
    (sj?.results?.bindings ?? []).forEach((b: any) => {
      const id = b.d.value.split("/").pop();
      const label = b.dl.value;
      const via = termLabel[b.t.value.split("/").pop()];
      if (id && !byId.has(id)) {
        const row: VocabRow = { id, label, via: (via && via.toLowerCase() !== label.toLowerCase()) ? via : null };
        byId.set(id, row); rows.push(row);
      }
    });
  }
  return rows.slice(0, 25);
}

export async function meshVocabDetails(label: string, id?: string): Promise<VocabDetails> {
  const [entry, scopeNote] = await Promise.all([
    meshEntryTerms(label),
    id ? meshScopeNote(id) : Promise.resolve(""),
  ]);
  return entry
    ? { terms: entry.terms, bt: entry.bt, nt: entry.nt, scopeNote }
    : { terms: [], bt: [], nt: [], scopeNote };
}
