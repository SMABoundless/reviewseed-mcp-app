// ReviewSeed — MCP App UI
// Three sources (PubMed, ClinicalTrials.gov, ERIC), a MeSH/ERIC vocabulary
// explorer, and ten search-strategy frameworks. All network calls route
// through the MCP server via app.callServerTool(); query assembly (pure,
// no I/O) is shared with the server from ../server/query.ts so the live
// preview here and the headless reviewseed_assemble_query tool never drift.
import { App } from "@modelcontextprotocol/ext-apps";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { buildBooleanQuery, buildFrameworkQuery, FRAMEWORKS, type Pool } from "../server/query.js";
import type { Article, Source, VocabRow } from "../server/types.js";

const mcpApp = new App({ name: "ReviewSeed", version: "2.0.0" });

// ── Constants ──────────────────────────────────────────────────────────────────
const NU_PURPLE = "#4E2A84";
const NU_DARK   = "#3b1f63";
const NU_LIGHT  = "#E8E3F0";
const NU_MID    = "#B6A6D0";
const GREEN_DARK = "#1a6b3a";
const GREEN_BG   = "#e3f2ec";
const GREEN_MID  = "#7dba9a";
const ERIC_TEAL  = "#0f7a72";
const ERIC_BG    = "#e2f2f0";
const ERIC_MID   = "#7fc4bd";
const KW_FIELDS = [
  { label: "Title/Abstract", tag: "tiab" },
  { label: "Title",          tag: "ti"   },
  { label: "Abstract",       tag: "ab"   },
  { label: "All Fields",     tag: "all"  },
];
const SOURCE_LABEL: Record<Source, string> = { pubmed: "PubMed", eric: "ERIC", trials: "ClinicalTrials.gov" };
const SOURCE_HOME: Record<Source, string> = {
  pubmed: "https://pubmed.ncbi.nlm.nih.gov/?term=",
  eric: "https://eric.ed.gov/?q=",
  trials: "https://clinicaltrials.gov/search?term=",
};
type Mode = "search" | "advanced" | "paste" | "vocab";
type Tab = "harvest" | "boolean" | "framework";

const GUIDE = [
  { heading: "Step 1 — Pick a source and find records", body:
    `Switch between PubMed (biomedical literature), ClinicalTrials.gov (registry — a required step in Cochrane/PRISMA systematic reviews), and ERIC (education research) with the source toggle.

Search: type any query, results appear 10 at a time.
Advanced Search: build a field-specific query (Author, MeSH Terms, Publication Type for PubMed; Descriptor/Education Level for ERIC; Condition/Phase/Status for Trials), combining rows with AND/OR/NOT.
Paste Citations: paste a reference list — PMIDs/DOIs (PubMed), EJ/ED numbers (ERIC), or NCT ids (Trials) are most reliable; titles are a best-effort fallback.
Vocabulary Explorer: search MeSH or the ERIC Thesaurus by heading OR synonym — "heart attack" finds Myocardial Infarction, with the cross-reference shown.` },
  { heading: "Step 2 — Select records and harvest", body:
    `Each card shows title, authors, journal, year, and its MeSH headings / ERIC descriptors / keywords as clickable chips.

Select records by clicking a card, then Harvest from N selected — or click individual chips to harvest one term at a time. Click an author's name to pull up everything they've published.` },
  { heading: "Step 3 — Explore the vocabulary directly", body:
    `In the Vocabulary Explorer tab, expand any result for its scope note (MeSH), entry terms / Use-For synonyms (addable as keywords), and broader/narrower headings you can click to walk the hierarchy — without leaving the tab. The MeSH pool is shared between PubMed and Trials.` },
  { heading: "Step 4 — Build your search string", body:
    `Boolean Builder: click terms to include them; three operators control keyword/vocab/join logic.
Framework Builder: pick from ten established frameworks (PICO, PICOS, PECO, SPICE, CIMO, SPIDER, PICo, PCC, ECLIPSE, PIRD) or Custom, then drag terms into concept buckets. Both builders emit syntax for whichever source is active — PubMed bracket tags, ERIC field prefixes, or ClinicalTrials.gov AREA[...] operators.` },
];

// ── Types ──────────────────────────────────────────────────────────────────────
interface VocabDetailsState {
  label: string;
  vocab: "mesh" | "eric";
  loading: boolean;
  scopeNote?: string;
  terms?: string[];
  bt?: string[];
  nt?: string[];
}
interface AdvRow { field: string; value: string; op: "AND" | "OR" | "NOT" }
interface AdvField { label: string; tag: string }
interface CustomBucket { key: string; label: string }
type BucketMap = Record<string, string[]>;

// ── MCP server call helper ─────────────────────────────────────────────────────
async function callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const result = await mcpApp.callServerTool({ name, arguments: args });
  const text = result.content?.find((c: { type: string }) => c.type === "text") as { text: string } | undefined;
  if (!text) throw new Error(`No text content in ${name} response`);
  return JSON.parse(text.text) as T;
}

// ── Chip ───────────────────────────────────────────────────────────────────────
type ChipType = "keyword" | "mesh" | "eric" | "query";
function chipColors(type: ChipType, selected: boolean | undefined) {
  const scheme = type === "mesh" ? { bg: NU_LIGHT, sel: NU_PURPLE, fg: NU_DARK, border: NU_MID }
    : type === "eric" ? { bg: ERIC_BG, sel: ERIC_TEAL, fg: ERIC_TEAL, border: ERIC_MID }
    : { bg: GREEN_BG, sel: GREEN_DARK, fg: GREEN_DARK, border: GREEN_MID };
  return {
    background: selected ? scheme.sel : scheme.bg,
    color: selected ? "#fff" : scheme.fg,
    border: `1.5px solid ${scheme.border}`,
  };
}
function typeGlyph(type: ChipType) { return type === "mesh" ? "⬡ " : type === "eric" ? "◆ " : type === "query" ? "» " : "# "; }

interface ChipProps {
  term: string; type: ChipType; selected?: boolean; onClick?: () => void;
  draggable?: boolean; onDragStart?: (e: React.DragEvent) => void;
  field?: string; onFieldChange?: (term: string, field: string) => void; onRemove?: (term: string) => void;
  onDetails?: () => void; detailsOpen?: boolean;
}
function Chip({ term, type, selected, onClick, draggable, onDragStart, field, onFieldChange, onRemove, onDetails, detailsOpen }: ChipProps) {
  const colors = chipColors(type, selected);
  const handleKey = (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); } };
  return (
    <span draggable={draggable} onDragStart={onDragStart}
      role={onClick ? "checkbox" : undefined} aria-checked={onClick ? !!selected : undefined}
      aria-label={`${term} (${type})`} tabIndex={onClick ? 0 : undefined} onKeyDown={onClick ? handleKey : undefined}
      style={{ display: "inline-flex", alignItems: "center", margin: 3, borderRadius: 20, fontSize: 13,
        ...colors, userSelect: "none", overflow: "hidden", outline: "none" }}>
      <span onClick={onClick} style={{ padding: "4px 8px 4px 10px", cursor: onClick ? "pointer" : "default" }}>
        {typeGlyph(type)}{term}
      </span>
      {type === "keyword" && onFieldChange && (
        <select value={field || "tiab"} aria-label={`Search field for ${term}`}
          onChange={e => { e.stopPropagation(); onFieldChange(term, e.target.value); }} onClick={e => e.stopPropagation()}
          style={{ fontSize: 11, border: "none", borderLeft: `1px solid ${selected ? "rgba(255,255,255,0.4)" : GREEN_MID}`,
            background: selected ? "rgba(0,0,0,0.15)" : "#d4edda", color: selected ? "#fff" : GREEN_DARK,
            padding: "0 4px", cursor: "pointer", height: "100%", outline: "none" }}>
          {KW_FIELDS.map(f => <option key={f.tag} value={f.tag}>{f.label}</option>)}
        </select>
      )}
      {onDetails && (
        <button onClick={e => { e.stopPropagation(); onDetails(); }} aria-expanded={detailsOpen}
          aria-label={`${detailsOpen ? "Hide" : "Show"} details for ${term}`}
          style={{ padding: "0 8px", background: "none", border: "none", borderLeft: `1px solid ${selected ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.15)"}`,
            color: "inherit", fontSize: 11, cursor: "pointer" }}>
          {detailsOpen ? "▴" : "▾"}
        </button>
      )}
      {onRemove && (
        <button onClick={e => { e.stopPropagation(); onRemove(term); }} aria-label={`Remove ${term}`}
          style={{ padding: "0 8px 0 2px", cursor: "pointer", background: "none", border: "none", color: "inherit", fontSize: 15, lineHeight: 1, opacity: 0.7 }}>×</button>
      )}
    </span>
  );
}

// ── Vocabulary Explorer ─────────────────────────────────────────────────────────
interface VocabExplorerProps {
  source: Source; pool: Pool;
  onAddKeyword: (t: string) => void; onAddVocab: (t: string) => void;
}
function VocabExplorer({ source, pool, onAddKeyword, onAddVocab }: VocabExplorerProps) {
  const vocab: "mesh" | "eric" = source === "eric" ? "eric" : "mesh";
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<VocabRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [details, setDetails] = useState<VocabDetailsState | null>(null);
  const epochRef = useRef(0);

  const runSearch = async (q: string) => {
    setQuery(q); setDetails(null);
    if (q.trim().length < 2) { setRows([]); setErr(""); return; }
    const my = ++epochRef.current;
    setLoading(true); setErr("");
    try {
      const r = await callTool<{ rows: VocabRow[]; error?: string }>("reviewseed_vocab_search", { vocab, query: q });
      if (epochRef.current !== my) return;
      if (r.error) setErr(r.error);
      setRows(r.rows ?? []);
    } catch { if (epochRef.current === my) { setRows([]); setErr("Search failed."); } }
    if (epochRef.current === my) setLoading(false);
  };

  const toggleDetails = async (row: VocabRow) => {
    if (details?.label === row.label) { setDetails(null); return; }
    setDetails({ label: row.label, vocab, loading: true });
    try {
      const d = await callTool<{ scopeNote: string; terms: string[]; bt: string[]; nt: string[]; error?: string }>(
        "reviewseed_vocab_details", { vocab, label: row.label, id: row.id },
      );
      setDetails({ label: row.label, vocab, loading: false, scopeNote: d.scopeNote, terms: d.terms, bt: d.bt, nt: d.nt });
    } catch { setDetails({ label: row.label, vocab, loading: false, scopeNote: "", terms: [], bt: [], nt: [] }); }
  };

  const vocabPool = source === "eric" ? pool.eric : pool.mesh;

  return (
    <div>
      <input value={query} onChange={e => runSearch(e.target.value)}
        placeholder={vocab === "mesh" ? "Search MeSH headings or synonyms (e.g. heart attack)" : "Search the ERIC Thesaurus (descriptors or synonyms)"}
        aria-label={`Search ${vocab === "mesh" ? "MeSH" : "ERIC Thesaurus"}`}
        style={{ width: "100%", padding: "9px 14px", borderRadius: 7, border: `1.5px solid ${NU_MID}`, fontSize: 14, boxSizing: "border-box", color: "#1a1a2e" }} />
      <div style={{ marginTop: 6, fontSize: 11, color: "#888" }}>headings &amp; entry terms · expand a row for scope note, synonyms, hierarchy</div>
      <div role="status" aria-live="polite" style={{ marginTop: 8, maxHeight: 320, overflowY: "auto" }}>
        {loading && <div style={{ fontSize: 12, color: "#888", padding: "4px 0" }}>Searching…</div>}
        {err && <div role="alert" style={{ fontSize: 12, color: "#8b0000" }}>{err}</div>}
        {!loading && !err && query.trim().length >= 2 && rows.length === 0 && (
          <div style={{ fontSize: 12, color: "#888", fontStyle: "italic" }}>No headings or entry terms match "{query}".</div>
        )}
        {rows.map(row => {
          const inPool = vocabPool.includes(row.label);
          const open = details?.label === row.label;
          return (
            <div key={row.id ?? row.label} style={{ padding: "8px 0", borderBottom: `1px solid ${NU_LIGHT}` }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 13, color: "#1a1a2e" }}>{row.label}</div>
                  {row.via && <div style={{ fontSize: 11, color: "#888", fontStyle: "italic" }}>matched "{row.via}" → use {row.label}</div>}
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button onClick={() => toggleDetails(row)} aria-expanded={open} style={{ fontSize: 10, padding: "3px 7px", background: "transparent", color: "#888", border: "1px solid #ccc", borderRadius: 3, cursor: "pointer" }}>
                    {open ? "details ▴" : "details ▾"}
                  </button>
                  <button disabled={inPool} onClick={() => onAddVocab(row.label)}
                    style={{ fontSize: 10, padding: "3px 9px", background: "transparent", color: inPool ? "#888" : NU_PURPLE, border: `1px solid ${inPool ? "#ccc" : NU_PURPLE}`, borderRadius: 3, cursor: inPool ? "default" : "pointer", fontWeight: 600 }}>
                    {inPool ? "Added" : "Add"}
                  </button>
                </div>
              </div>
              {open && (
                <div style={{ marginTop: 6, padding: "8px 10px", background: "#faf9fd", borderRadius: 4 }}>
                  {details?.loading ? <div style={{ fontSize: 12, color: "#888", fontStyle: "italic" }}>Looking up details…</div> : (
                    <>
                      {details?.scopeNote && <div style={{ fontSize: 12, color: "#444", marginBottom: 6 }}>{details.scopeNote}</div>}
                      {!!details?.terms?.length && (
                        <div style={{ marginBottom: 6 }}>
                          <div style={{ fontSize: 9.5, color: "#888", textTransform: "uppercase", marginBottom: 3 }}>{vocab === "mesh" ? "entry terms" : "use for (synonyms)"}</div>
                          {details.terms.map(t => <Chip key={t} term={t} type="keyword" onClick={() => onAddKeyword(t)} />)}
                        </div>
                      )}
                      {!!details?.bt?.length && (
                        <div style={{ marginBottom: 6 }}>
                          <div style={{ fontSize: 9.5, color: "#888", textTransform: "uppercase", marginBottom: 3 }}>broader</div>
                          {details.bt.map(t => <button key={t} onClick={() => runSearch(t)} style={{ margin: 3, padding: "3px 8px", fontSize: 11, background: "transparent", border: "1px solid #ccc", borderRadius: 2, cursor: "pointer" }}>{t}</button>)}
                        </div>
                      )}
                      {!!details?.nt?.length && (
                        <div>
                          <div style={{ fontSize: 9.5, color: "#888", textTransform: "uppercase", marginBottom: 3 }}>narrower</div>
                          {details.nt.map(t => <button key={t} onClick={() => runSearch(t)} style={{ margin: 3, padding: "3px 8px", fontSize: 11, background: "transparent", border: "1px solid #ccc", borderRadius: 2, cursor: "pointer" }}>{t}</button>)}
                        </div>
                      )}
                      {!details?.scopeNote && !details?.terms?.length && !details?.bt?.length && !details?.nt?.length && (
                        <div style={{ fontSize: 12, color: "#888", fontStyle: "italic" }}>No additional detail for this heading.</div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Advanced Search ────────────────────────────────────────────────────────────
interface AdvancedSearchProps {
  source: Source; onRun: (query: string) => void; onAddToPool: (query: string) => void; loading: boolean;
}
function AdvancedSearch({ source, onRun, onAddToPool, loading }: AdvancedSearchProps) {
  const [fields, setFields] = useState<AdvField[]>([]);
  const [rows, setRows] = useState<AdvRow[]>([{ field: "", value: "", op: "AND" }]);

  useEffect(() => {
    setRows([{ field: "", value: "", op: "AND" }]);
    callTool<{ fields: AdvField[] }>("reviewseed_advanced_search", { source, rows: [] })
      .then(r => setFields(r.fields))
      .catch(() => setFields([]));
  }, [source]);

  const setRow = (i: number, patch: Partial<AdvRow>) => setRows(p => p.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const addRow = () => setRows(p => [...p, { field: fields[0]?.tag ?? "all", value: "", op: "AND" }]);
  const removeRow = (i: number) => setRows(p => p.filter((_, idx) => idx !== i));

  const validRows = rows.filter(r => r.value.trim() && r.field);
  const assemble = async (run: boolean) => {
    const r = await callTool<{ query: string }>("reviewseed_advanced_search", {
      source, rows: validRows.map(r => ({ field: r.field, value: r.value, op: r.op })), run: false,
    });
    if (run) onRun(r.query); else onAddToPool(r.query);
  };

  return (
    <div>
      {rows.map((row, i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
          {i > 0 && (
            <select value={row.op} onChange={e => setRow(i, { op: e.target.value as AdvRow["op"] })}
              style={{ width: 66, fontSize: 12, borderRadius: 4, border: `1.5px solid ${NU_MID}` }}>
              <option>AND</option><option>OR</option><option>NOT</option>
            </select>
          )}
          <select value={row.field} onChange={e => setRow(i, { field: e.target.value })}
            style={{ flex: "0 0 170px", fontSize: 12, borderRadius: 4, border: `1.5px solid ${NU_MID}`, padding: "6px 4px" }}>
            <option value="">Field…</option>
            {fields.map(f => <option key={f.tag} value={f.tag}>{f.label}</option>)}
          </select>
          <input value={row.value} onChange={e => setRow(i, { value: e.target.value })} placeholder="value"
            style={{ flex: 1, fontSize: 13, padding: "6px 10px", borderRadius: 4, border: `1.5px solid ${NU_MID}`, color: "#1a1a2e" }} />
          {rows.length > 1 && (
            <button onClick={() => removeRow(i)} aria-label="Remove row" style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 16 }}>×</button>
          )}
        </div>
      ))}
      <button onClick={addRow} style={{ fontSize: 12, padding: "4px 10px", border: `1.5px solid ${NU_PURPLE}`, borderRadius: 5, background: "#fff", color: NU_PURPLE, cursor: "pointer" }}>+ Add row</button>
      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
        <button disabled={!validRows.length || loading} onClick={() => assemble(true)}
          style={{ padding: "8px 18px", background: validRows.length ? NU_PURPLE : "#ccc", color: "#fff", border: "none", borderRadius: 6, cursor: validRows.length ? "pointer" : "not-allowed", fontWeight: 700, fontSize: 13 }}>
          {loading ? "Searching…" : `Search ${SOURCE_LABEL[source]}`}
        </button>
        <button disabled={!validRows.length} onClick={() => assemble(false)}
          style={{ padding: "8px 18px", background: "#fff", color: NU_PURPLE, border: `1.5px solid ${NU_PURPLE}`, borderRadius: 6, cursor: validRows.length ? "pointer" : "not-allowed", fontWeight: 600, fontSize: 13 }}>
          Add to pool
        </button>
      </div>
    </div>
  );
}

// ── Boolean Builder ────────────────────────────────────────────────────────────
interface BuilderProps { source: Source; pool: Pool; kwFields: Record<string, string>; onFieldChange: (t: string, f: string) => void }
function BooleanBuilder({ source, pool, kwFields, onFieldChange }: BuilderProps) {
  const [selKw, setSelKw] = useState(new Set<string>());
  const [selVocab, setSelVocab] = useState(new Set<string>());
  const [selQ, setSelQ] = useState(new Set<string>());
  const [kwOp, setKwOp] = useState<"OR" | "AND">("OR");
  const [vocabOp, setVocabOp] = useState<"OR" | "AND">("OR");
  const [joinOp, setJoinOp] = useState<"AND" | "OR">("AND");
  const [copied, setCopied] = useState(false);

  const toggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>) => (t: string) =>
    setter(p => { const n = new Set(p); n.has(t) ? n.delete(t) : n.add(t); return n; });

  const vocabPool = source === "eric" ? pool.eric : pool.mesh;
  const vocabType: ChipType = source === "eric" ? "eric" : "mesh";
  const queryPool = source === "eric" ? pool.ericQueries : source === "trials" ? pool.ctQueries : pool.queries;

  const subPool: Pool = { ...pool, keywords: [...selKw], mesh: source !== "eric" ? [...selVocab] : [], eric: source === "eric" ? [...selVocab] : [], queries: source === "pubmed" ? [...selQ] : [], ericQueries: source === "eric" ? [...selQ] : [], ctQueries: source === "trials" ? [...selQ] : [] };
  const query = buildBooleanQuery(subPool, kwFields, { kwOp, vocabOp, joinOp }, source);

  const copy = async () => { try { await navigator.clipboard.writeText(query); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard unavailable */ } };

  return (
    <div>
      <p style={{ fontSize: 13, color: "#444", marginTop: 0 }}>Click terms to include them in the search string.</p>
      {pool.keywords.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: GREEN_DARK, marginBottom: 4, textTransform: "uppercase" }}>Keywords</div>
          {pool.keywords.map(t => <Chip key={t} term={t} type="keyword" selected={selKw.has(t)} onClick={() => toggle(setSelKw)(t)} field={kwFields[t]} onFieldChange={onFieldChange} />)}
        </div>
      )}
      {vocabPool.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: NU_PURPLE, marginBottom: 4, textTransform: "uppercase" }}>{source === "eric" ? "ERIC Descriptors" : "MeSH Headings"}</div>
          {vocabPool.map(t => <Chip key={t} term={t} type={vocabType} selected={selVocab.has(t)} onClick={() => toggle(setSelVocab)(t)} />)}
        </div>
      )}
      {queryPool.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#555", marginBottom: 4, textTransform: "uppercase" }}>Advanced-search snippets</div>
          {queryPool.map(t => <Chip key={t} term={t} type="query" selected={selQ.has(t)} onClick={() => toggle(setSelQ)(t)} />)}
        </div>
      )}
      {(selKw.size > 0 || selVocab.size > 0) && (
        <div style={{ display: "flex", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
          <label style={{ fontSize: 12 }}>Keyword op <select value={kwOp} onChange={e => setKwOp(e.target.value as any)}><option>OR</option><option>AND</option></select></label>
          <label style={{ fontSize: 12 }}>Vocab op <select value={vocabOp} onChange={e => setVocabOp(e.target.value as any)}><option>OR</option><option>AND</option></select></label>
          <label style={{ fontSize: 12 }}>Join <select value={joinOp} onChange={e => setJoinOp(e.target.value as any)}><option>AND</option><option>OR</option></select></label>
        </div>
      )}
      {query && (
        <QueryBox query={query} copied={copied} onCopy={copy} source={source} />
      )}
    </div>
  );
}

// ── Framework Builder ──────────────────────────────────────────────────────────
function FrameworkBuilder({ source, pool, kwFields }: BuilderProps) {
  const [fwKey, setFwKey] = useState("PICO");
  const [buckets, setBuckets] = useState<BucketMap>({});
  const [customBuckets, setCustomBuckets] = useState<CustomBucket[]>([{ key: "c1", label: "Concept 1" }, { key: "c2", label: "Concept 2" }, { key: "c3", label: "Concept 3" }]);
  const [dragTerm, setDragTerm] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fw = fwKey === "Custom" ? { ...FRAMEWORKS.Custom, buckets: customBuckets } : FRAMEWORKS[fwKey];
  const vocabPool = source === "eric" ? pool.eric : pool.mesh;
  const vocabType: ChipType = source === "eric" ? "eric" : "mesh";
  const queryPool = source === "eric" ? pool.ericQueries : source === "trials" ? pool.ctQueries : pool.queries;
  const allTerms = [...pool.keywords, ...vocabPool, ...queryPool];
  const placed = new Set(Object.values(buckets).flat());
  const unplaced = allTerms.filter(t => !placed.has(t));

  const dropInto = (key: string) => (e: React.DragEvent) => {
    e.preventDefault();
    if (!dragTerm) return;
    setBuckets(p => ({ ...p, [key]: [...(p[key] ?? []).filter(t => t !== dragTerm), dragTerm] }));
    setDragTerm(null);
  };
  const removeFrom = (key: string, term: string) => setBuckets(p => ({ ...p, [key]: (p[key] ?? []).filter(t => t !== term) }));

  const query = buildFrameworkQuery(fwKey === "Custom" ? "Custom" : fwKey, buckets, pool, kwFields, source);
  const copy = async () => { try { await navigator.clipboard.writeText(query.replace(/\n/g, " ")); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard unavailable */ } };

  const termType = (t: string): ChipType => pool.keywords.includes(t) ? "keyword" : vocabPool.includes(t) ? vocabType : "query";

  const addCustomBucket = () => customBuckets.length < 6 && setCustomBuckets(p => [...p, { key: `c${p.length + 1}`, label: `Concept ${p.length + 1}` }]);
  const removeCustomBucket = (key: string) => setCustomBuckets(p => p.length > 1 ? p.filter(b => b.key !== key) : p);
  const renameCustomBucket = (key: string, label: string) => setCustomBuckets(p => p.map(b => b.key === key ? { ...b, label } : b));

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <select value={fwKey} onChange={e => { setFwKey(e.target.value); setBuckets({}); }}
          style={{ fontSize: 13, padding: "6px 10px", borderRadius: 6, border: `1.5px solid ${NU_MID}`, fontWeight: 700, color: NU_DARK }}>
          {Object.entries(FRAMEWORKS).map(([k, f]) => <option key={k} value={k}>{f.label} — {f.tag}</option>)}
        </select>
        <span style={{ fontSize: 12, color: "#666" }}>{fw.full}</span>
      </div>
      <p style={{ fontSize: 12, color: "#888", marginTop: 0 }}>{fw.blurb} Drag terms into a bucket; terms within a bucket are OR'd, buckets are AND'd.</p>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#555", textTransform: "uppercase", marginBottom: 6 }}>Term pool — drag to a bucket</div>
        <div style={{ minHeight: 36, padding: 6, background: NU_LIGHT, borderRadius: 8, border: `1px dashed ${NU_MID}` }}>
          {unplaced.length === 0 && <span style={{ fontSize: 12, color: "#888", padding: "4px 8px" }}>All terms placed, or no terms harvested yet.</span>}
          {unplaced.map(t => <Chip key={t} term={t} type={termType(t)} draggable onDragStart={e => { e.dataTransfer.effectAllowed = "move"; setDragTerm(t); }} />)}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        {fw.buckets.map(b => (
          <div key={b.key} onDragOver={e => e.preventDefault()} onDrop={dropInto(b.key)}
            style={{ border: `1.5px dashed ${NU_MID}`, borderRadius: 8, padding: 10, minHeight: 64, background: "#faf9fd" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              {fwKey === "Custom" ? (
                <input value={b.label} onChange={e => renameCustomBucket(b.key, e.target.value)}
                  style={{ fontSize: 12, fontWeight: 700, color: NU_PURPLE, border: "none", background: "transparent", width: "70%" }} />
              ) : <div style={{ fontSize: 12, fontWeight: 700, color: NU_PURPLE, textTransform: "uppercase" }}>{b.label}</div>}
              {fwKey === "Custom" && customBuckets.length > 1 && (
                <button onClick={() => removeCustomBucket(b.key)} style={{ background: "none", border: "none", color: "#888", cursor: "pointer" }}>×</button>
              )}
            </div>
            {(buckets[b.key] ?? []).map(t => <Chip key={t} term={t} type={termType(t)} selected onRemove={() => removeFrom(b.key, t)} />)}
            {!(buckets[b.key] ?? []).length && <span style={{ fontSize: 12, color: "#aaa" }}>Drop terms here</span>}
          </div>
        ))}
      </div>
      {fwKey === "Custom" && customBuckets.length < 6 && (
        <button onClick={addCustomBucket} style={{ fontSize: 12, padding: "4px 12px", border: `1.5px solid ${NU_PURPLE}`, borderRadius: 5, background: "#fff", color: NU_PURPLE, cursor: "pointer", marginBottom: 10 }}>+ Add concept</button>
      )}

      {query && <QueryBox query={query} copied={copied} onCopy={copy} source={source} />}
    </div>
  );
}

// ── Query display ──────────────────────────────────────────────────────────────
function QueryBox({ query, copied, onCopy, source }: { query: string; copied: boolean; onCopy: () => void; source: Source }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div aria-live="polite" aria-label="Generated search string"
        style={{ background: "#f8f6fc", border: `1.5px solid ${NU_MID}`, borderRadius: 8, padding: "10px 14px", fontFamily: "monospace", fontSize: 13, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "#1a1a2e" }}>
        {query}
      </div>
      <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={onCopy} style={{ padding: "6px 16px", background: copied ? GREEN_DARK : NU_PURPLE, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
          {copied ? "✓ Copied" : "Copy to Clipboard"}
        </button>
        <button onClick={() => window.open(`${SOURCE_HOME[source]}${encodeURIComponent(query.replace(/\n/g, " "))}`, "_blank")}
          style={{ padding: "6px 16px", background: "#fff", color: NU_PURPLE, border: `1.5px solid ${NU_PURPLE}`, borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
          🔗 Run in {SOURCE_LABEL[source]}
        </button>
      </div>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────────
function ReviewSeed() {
  const [source, setSource] = useState<Source>("pubmed");
  const [mode, setMode] = useState<Mode>("search");
  const [tab, setTab] = useState<Tab>("harvest");
  const [query, setQuery] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [articles, setArticles] = useState<Article[]>([]);
  const [selected, setSelected] = useState(new Set<string>());
  const [pool, setPool] = useState<Pool>({ keywords: [], mesh: [], eric: [], queries: [], ericQueries: [], ctQueries: [] });
  const [kwFields, setKwFields] = useState<Record<string, string>>({});
  const [guideOpen, setGuideOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => { mcpApp.connect(); }, []);
  useEffect(() => { setQuery(""); setPasteText(""); setArticles([]); setSelected(new Set()); setError(""); setPage(1); }, [source, mode]);

  const setField = (term: string, field: string) => setKwFields(p => ({ ...p, [term]: field }));
  const poolKey = (t: "keyword" | "vocab" | "query"): keyof Pool =>
    t === "keyword" ? "keywords" : t === "vocab" ? (source === "eric" ? "eric" : "mesh") : (source === "eric" ? "ericQueries" : source === "trials" ? "ctQueries" : "queries");
  const addToPool = (t: "keyword" | "vocab" | "query", term: string) => setPool(p => {
    const key = poolKey(t);
    return p[key].includes(term) ? p : { ...p, [key]: [...p[key], term] };
  });

  const applyResult = (r: { articles: Article[]; total?: number; error?: string }) => {
    if (r.error) { setError(r.error); setArticles([]); return; }
    setArticles(r.articles); setTotal(r.total ?? r.articles.length);
    if (!r.articles.length) setError("No results found.");
  };

  const doSearch = async (targetPage = 1) => {
    if (!query.trim()) return;
    setLoading(true); setError(""); setSelected(new Set());
    try { applyResult(await callTool("reviewseed_search", { source, query, page: targetPage, pageSize: 10 })); setPage(targetPage); }
    catch { setError("Search failed. Check your connection and try again."); }
    setLoading(false);
  };

  const doLookup = async () => {
    if (!pasteText.trim()) return;
    setLoading(true); setError(""); setSelected(new Set());
    try {
      const r = await callTool<{ articles: Article[]; error?: string }>("reviewseed_lookup", { source, text: pasteText });
      applyResult(r);
      if (r.articles?.length) setSelected(new Set(r.articles.map(a => a.pmid)));
    } catch { setError("Lookup failed. Check your connection and try again."); }
    setLoading(false);
  };

  const doAuthorSearch = async (name: string) => {
    setLoading(true); setError(""); setMode("search"); setQuery(`author: ${name}`); setSelected(new Set());
    try { applyResult(await callTool("reviewseed_author_search", { source, name, page: 1 })); }
    catch { setError("Author search failed."); }
    setLoading(false);
  };

  const harvestSelected = () => {
    const sel = articles.filter(a => selected.has(a.pmid));
    setPool(p => ({
      ...p,
      keywords: [...new Set([...p.keywords, ...sel.flatMap(a => a.keywords)])],
      mesh: [...new Set([...p.mesh, ...sel.flatMap(a => a.mesh)])],
      eric: [...new Set([...p.eric, ...sel.flatMap(a => a.eric)])],
    }));
    setTab("harvest");
  };

  const totalHarvested = pool.keywords.length + pool.mesh.length + pool.eric.length + pool.queries.length + pool.ericQueries.length + pool.ctQueries.length;

  const primaryBtn = (disabled: boolean) => ({ padding: "9px 20px", background: disabled ? "#ccc" : NU_PURPLE, color: "#fff", border: "none", borderRadius: 7, cursor: disabled ? "not-allowed" : "pointer", fontSize: 14, fontWeight: 700 });

  return (
    <div style={{ fontFamily: "'Segoe UI', system-ui, sans-serif", minHeight: "100vh", background: "#f5f4f9" }}>
      {guideOpen && (
        <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", justifyContent: "center", background: "rgba(30,15,50,0.55)", padding: "40px 16px 24px", overflowY: "auto" }}>
          <div style={{ background: "#fff", borderRadius: 12, width: "100%", maxWidth: 680, height: "fit-content" }}>
            <div style={{ background: NU_PURPLE, borderRadius: "12px 12px 0 0", padding: "18px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ margin: 0, color: "#fff", fontSize: 20 }}>User Guide</h2>
              <button onClick={() => setGuideOpen(false)} aria-label="Close" style={{ background: "rgba(255,255,255,0.15)", border: "2px solid rgba(255,255,255,0.4)", color: "#fff", borderRadius: 6, width: 36, height: 36, cursor: "pointer" }}>×</button>
            </div>
            <div style={{ padding: "24px 28px 32px", maxHeight: "75vh", overflowY: "auto" }}>
              {GUIDE.map((s, i) => (
                <section key={i} style={{ marginBottom: 24 }}>
                  <h3 style={{ margin: "0 0 8px", color: NU_PURPLE, fontSize: 15, borderBottom: `2px solid ${NU_LIGHT}`, paddingBottom: 6 }}>{s.heading}</h3>
                  <p style={{ margin: 0, fontSize: 13.5, color: "#2d2d2d", lineHeight: 1.7, whiteSpace: "pre-line" }}>{s.body}</p>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}

      <header style={{ background: NU_PURPLE, color: "#fff", padding: "16px 28px", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span aria-hidden="true" style={{ fontSize: 28 }}>🌱</span>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>ReviewSeed</h1>
            <p style={{ margin: 0, fontSize: 13, opacity: 0.85 }}>PubMed · ClinicalTrials.gov · ERIC — vocabulary explorer · ten search frameworks</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => setAboutOpen(o => !o)} style={{ padding: "7px 16px", background: "rgba(255,255,255,0.15)", color: "#fff", border: "2px solid rgba(255,255,255,0.5)", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>{aboutOpen ? "Hide About" : "About"}</button>
          <button onClick={() => setGuideOpen(true)} style={{ padding: "7px 16px", background: "#fff", color: NU_PURPLE, border: "2px solid #fff", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>User Guide</button>
        </div>
      </header>

      {aboutOpen && (
        <div style={{ background: NU_DARK, color: "#fff" }}>
          <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 28px" }}>
            <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.8, fontStyle: "italic" }}>
              ReviewSeed builds systematic and scoping review search strings across PubMed, ClinicalTrials.gov, and ERIC.
              Search or paste citations to harvest each source's real controlled vocabulary and keywords, explore MeSH or
              the ERIC Thesaurus directly (synonyms, scope notes, broader/narrower hierarchy), then assemble a Boolean or
              ten-framework (PICO, PECO, SPIDER, PCC, and more) search string in the target database's own syntax. All
              calls go through the MCP server to each database's public API — no data is stored.
            </p>
          </div>
        </div>
      )}

      <main style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px" }}>
        {/* Source switcher */}
        <div role="group" aria-label="Source" style={{ display: "flex", marginBottom: 14, borderRadius: 8, overflow: "hidden", border: `2px solid ${NU_PURPLE}`, width: "fit-content" }}>
          {(["pubmed", "trials", "eric"] as Source[]).map(s => (
            <button key={s} onClick={() => setSource(s)} aria-pressed={source === s}
              style={{ padding: "8px 18px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, background: source === s ? NU_PURPLE : "#fff", color: source === s ? "#fff" : NU_PURPLE }}>
              {SOURCE_LABEL[s]}
            </button>
          ))}
        </div>

        {/* Mode toggle */}
        <div role="group" aria-label="Input mode" style={{ display: "flex", marginBottom: 20, borderRadius: 8, overflow: "hidden", border: `2px solid ${NU_MID}`, width: "fit-content", flexWrap: "wrap" }}>
          {([["search", "🔍 Search"], ["advanced", "🎛 Advanced"], ["paste", "📋 Paste Citations"], ["vocab", "📖 Vocabulary Explorer"]] as [Mode, string][]).map(([m, label]) => (
            <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m}
              style={{ padding: "7px 16px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, background: mode === m ? NU_MID : "#fff", color: mode === m ? "#fff" : NU_DARK }}>
              {label}
            </button>
          ))}
        </div>

        <div style={{ background: "#fff", borderRadius: 10, padding: 20, marginBottom: 20, boxShadow: "0 2px 8px rgba(78,42,132,0.08)" }}>
          {mode === "search" && (
            <div style={{ display: "flex", gap: 10 }}>
              <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && doSearch(1)}
                placeholder={`Search ${SOURCE_LABEL[source]}`} aria-label={`Search ${SOURCE_LABEL[source]}`}
                style={{ flex: 1, padding: "9px 14px", borderRadius: 7, border: `1.5px solid ${NU_MID}`, fontSize: 14, color: "#1a1a2e" }} />
              <button onClick={() => doSearch(1)} disabled={loading || !query.trim()} style={primaryBtn(loading || !query.trim())}>{loading ? "Searching…" : "Search"}</button>
            </div>
          )}
          {mode === "advanced" && (
            <AdvancedSearch source={source} loading={loading}
              onRun={async q => { setQuery(q); setLoading(true); setSelected(new Set()); try { applyResult(await callTool("reviewseed_search", { source, query: q, page: 1, pageSize: 10 })); setPage(1); } catch { setError("Search failed."); } setLoading(false); }}
              onAddToPool={q => addToPool("query", q)} />
          )}
          {mode === "paste" && (
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Paste citations</label>
              <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} rows={6}
                placeholder="PMID: 30567716 / EJ1234567 / NCT01234567 / 10.1007/s10459-018-9865-9 — or plain text references"
                style={{ width: "100%", padding: "9px 14px", borderRadius: 7, border: `1.5px solid ${NU_MID}`, fontSize: 13, boxSizing: "border-box", color: "#1a1a2e" }} />
              <button onClick={doLookup} disabled={loading || !pasteText.trim()} style={{ ...primaryBtn(loading || !pasteText.trim()), marginTop: 10 }}>{loading ? "Looking up…" : "Look Up Citations"}</button>
            </div>
          )}
          {mode === "vocab" && <VocabExplorer source={source} pool={pool} onAddKeyword={t => addToPool("keyword", t)} onAddVocab={t => addToPool("vocab", t)} />}

          {error && <div role="alert" style={{ marginTop: 10, padding: "8px 12px", background: "#fef2f2", borderRadius: 6, color: "#8b0000", fontSize: 13 }}>⚠️ {error}</div>}
        </div>

        {mode !== "vocab" && articles.length > 0 && (
          <section style={{ background: "#fff", borderRadius: 10, padding: 20, marginBottom: 20, boxShadow: "0 2px 8px rgba(78,42,132,0.08)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
              <h2 style={{ margin: 0, fontSize: 17, color: NU_PURPLE }}>Results <span style={{ fontWeight: 400, fontSize: 13, color: "#444" }}>({total} total · {selected.size} selected)</span></h2>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setSelected(new Set(articles.map(a => a.pmid)))} style={{ fontSize: 12, padding: "4px 12px", border: `1.5px solid ${NU_PURPLE}`, borderRadius: 5, background: "#fff", color: NU_PURPLE, cursor: "pointer" }}>Select All</button>
                <button onClick={() => setSelected(new Set())} style={{ fontSize: 12, padding: "4px 12px", border: "1.5px solid #888", borderRadius: 5, background: "#fff", cursor: "pointer" }}>Clear</button>
                <button onClick={harvestSelected} disabled={!selected.size} style={{ fontSize: 12, padding: "4px 14px", background: selected.size ? NU_PURPLE : "#ccc", color: "#fff", border: "none", borderRadius: 5, cursor: selected.size ? "pointer" : "not-allowed", fontWeight: 700 }}>🌱 Harvest from {selected.size}</button>
              </div>
            </div>
            {articles.map(a => {
              const sel = selected.has(a.pmid);
              return (
                <div key={a.pmid} onClick={() => setSelected(p => { const n = new Set(p); n.has(a.pmid) ? n.delete(a.pmid) : n.add(a.pmid); return n; })}
                  role="checkbox" aria-checked={sel} tabIndex={0}
                  style={{ border: `2px solid ${sel ? NU_PURPLE : NU_LIGHT}`, borderRadius: 8, padding: "12px 14px", marginBottom: 10, cursor: "pointer", background: sel ? "#faf8ff" : "#fff" }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#1a1a2e", marginBottom: 2 }}>{a.title}</div>
                  <div style={{ fontSize: 12, color: "#555", marginBottom: 6 }}>
                    {a.authors.map((name, i) => (
                      <span key={name}>
                        {i > 0 && ", "}
                        <button onClick={e => { e.stopPropagation(); doAuthorSearch(name); }} style={{ background: "none", border: "none", padding: 0, color: NU_PURPLE, textDecoration: "underline", cursor: "pointer", fontSize: 12 }}>{name}</button>
                      </span>
                    ))}
                    {" "}· {a.journal}{a.year ? ` (${a.year})` : ""} · {a.pmid}{a.ctStatus ? ` · ${a.ctStatus}` : ""}
                  </div>
                  {(a.keywords.length > 0 || a.mesh.length > 0 || a.eric.length > 0) && (
                    <div onClick={e => e.stopPropagation()}>
                      {a.keywords.map(t => <Chip key={t} term={t} type="keyword" selected={pool.keywords.includes(t)} onClick={() => addToPool("keyword", t)} />)}
                      {a.mesh.map(t => <Chip key={t} term={t} type="mesh" selected={pool.mesh.includes(t)} onClick={() => addToPool("vocab", t)} />)}
                      {a.eric.map(t => <Chip key={t} term={t} type="eric" selected={pool.eric.includes(t)} onClick={() => addToPool("vocab", t)} />)}
                    </div>
                  )}
                </div>
              );
            })}
            {mode === "search" && (
              <div style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 8 }}>
                <button onClick={() => doSearch(page - 1)} disabled={page <= 1 || loading} style={{ padding: "4px 10px", border: `1.5px solid ${NU_MID}`, borderRadius: 5, background: "#fff", cursor: page > 1 ? "pointer" : "default" }}>← Prev</button>
                <span style={{ fontSize: 12, padding: "0 4px" }}>p.{page}{page >= 5 ? " (max)" : ""}</span>
                <button onClick={() => doSearch(page + 1)} disabled={page >= 5 || loading} style={{ padding: "4px 10px", border: `1.5px solid ${NU_MID}`, borderRadius: 5, background: "#fff", cursor: page < 5 ? "pointer" : "default" }}>Next →</button>
              </div>
            )}
          </section>
        )}

        <section style={{ background: "#fff", borderRadius: 10, boxShadow: "0 2px 8px rgba(78,42,132,0.08)" }}>
          <div role="tablist" style={{ display: "flex", borderBottom: `2px solid ${NU_LIGHT}`, overflow: "hidden", borderRadius: "10px 10px 0 0" }}>
            {([["harvest", `🌱 Harvested Terms ${totalHarvested ? `(${totalHarvested})` : ""}`], ["boolean", "Boolean Builder"], ["framework", "Framework Builder"]] as [Tab, string][]).map(([t, label]) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                style={{ padding: "8px 18px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, background: tab === t ? NU_PURPLE : "#fff", color: tab === t ? "#fff" : NU_PURPLE }}>
                {label}
              </button>
            ))}
          </div>
          <div style={{ padding: 20 }}>
            {tab === "harvest" && (
              totalHarvested === 0 ? <p style={{ fontSize: 14, color: "#666", margin: 0 }}>No terms harvested yet — search, select records, and Harvest, or click chips directly, or explore the vocabulary.</p> : (
                <>
                  {pool.keywords.length > 0 && <div style={{ marginBottom: 14 }}><div style={{ fontSize: 12, fontWeight: 700, color: GREEN_DARK, marginBottom: 6 }}>Keywords ({pool.keywords.length})</div>{pool.keywords.map(t => <Chip key={t} term={t} type="keyword" field={kwFields[t]} onFieldChange={setField} onRemove={t => setPool(p => ({ ...p, keywords: p.keywords.filter(x => x !== t) }))} />)}</div>}
                  {pool.mesh.length > 0 && <div style={{ marginBottom: 14 }}><div style={{ fontSize: 12, fontWeight: 700, color: NU_PURPLE, marginBottom: 6 }}>MeSH Headings ({pool.mesh.length})</div>{pool.mesh.map(t => <Chip key={t} term={t} type="mesh" onRemove={t => setPool(p => ({ ...p, mesh: p.mesh.filter(x => x !== t) }))} />)}</div>}
                  {pool.eric.length > 0 && <div style={{ marginBottom: 14 }}><div style={{ fontSize: 12, fontWeight: 700, color: ERIC_TEAL, marginBottom: 6 }}>ERIC Descriptors ({pool.eric.length})</div>{pool.eric.map(t => <Chip key={t} term={t} type="eric" onRemove={t => setPool(p => ({ ...p, eric: p.eric.filter(x => x !== t) }))} />)}</div>}
                  {([["queries", "PubMed advanced snippets"], ["ericQueries", "ERIC advanced snippets"], ["ctQueries", "Trials advanced snippets"]] as [keyof Pool, string][]).map(([key, label]) => pool[key].length > 0 && (
                    <div key={key} style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#555", marginBottom: 6 }}>{label} ({pool[key].length})</div>
                      {pool[key].map((t: string) => <Chip key={t} term={t} type="query" onRemove={r => setPool(p => ({ ...p, [key]: p[key].filter((x: string) => x !== r) }))} />)}
                    </div>
                  ))}
                </>
              )
            )}
            {tab === "boolean" && (totalHarvested === 0 ? <p style={{ fontSize: 14, color: "#666", margin: 0 }}>Harvest some terms first.</p> : <BooleanBuilder source={source} pool={pool} kwFields={kwFields} onFieldChange={setField} />)}
            {tab === "framework" && (totalHarvested === 0 ? <p style={{ fontSize: 14, color: "#666", margin: 0 }}>Harvest some terms first, then drag them into a framework's buckets here.</p> : <FrameworkBuilder source={source} pool={pool} kwFields={kwFields} onFieldChange={setField} />)}
          </div>
        </section>
      </main>
    </div>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<ReviewSeed />);
