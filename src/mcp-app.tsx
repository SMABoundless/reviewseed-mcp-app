// ReviewSeed — MCP App UI
// Visual language ported verbatim from reviewseed.library.northwestern.edu
// (index.html's T.light/T.dark tokens, SeedMark logo, Fraunces/Inter/JetBrains
// Mono type system) so this app and the website read as one product.
// Network calls route through the MCP server via app.callServerTool(); query
// assembly (pure, no I/O) is shared with the server from ../server/query.ts
// so the live preview here and the headless reviewseed_assemble_query tool
// never drift.
import { App } from "@modelcontextprotocol/ext-apps";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { buildBooleanQuery, buildFrameworkQuery, FRAMEWORKS, type Pool } from "../server/query.js";
import type { Article, Source, VocabRow } from "../server/types.js";

const mcpApp = new App({ name: "ReviewSeed", version: "2.0.0" });

// ── Theme — ported verbatim from the website's T.light / T.dark ───────────────
interface Theme {
  bg: string; surface: string; ink: string; ink2: string; ink3: string;
  line: string; lineStrong: string;
  accent: string; accentSoft: string;
  mesh: string; meshSoft: string;
  kw: string; kwSoft: string;
  chipBg: string; error: string; errorBg: string;
  adv: string; advSoft: string;
  eric: string; ericSoft: string;
  ct: string; ctSoft: string;
  queryBoxBg: string; queryBoxFg: string;
}
const T: { light: Theme; dark: Theme } = {
  light: {
    bg: "#f8f6f1", surface: "#ffffff", ink: "#14110d", ink2: "#4a4640", ink3: "#6f6a65",
    line: "#e4dfd4", lineStrong: "#c9c3b4",
    accent: "#1e5280", accentSoft: "#e4edf7",
    mesh: "#284e6e", meshSoft: "#e2eaf3",
    kw: "#3a5e2e", kwSoft: "#e8f0e3",
    chipBg: "#f0ece2", error: "#a03030", errorBg: "#fbe9e6",
    adv: "#4a3270", advSoft: "#ede8f5",
    eric: "#0e6660", ericSoft: "#e0efed",
    ct: "#8a5220", ctSoft: "#f5ead9",
    queryBoxBg: "#14110d", queryBoxFg: "#f3efe6",
  },
  dark: {
    bg: "#17150f", surface: "#1f1c15", ink: "#f3efe6", ink2: "#b7b1a1", ink3: "#928b80",
    line: "#2e2a20", lineStrong: "#443f31",
    accent: "#6aa3d4", accentSoft: "#1a2535",
    mesh: "#7aaac4", meshSoft: "#1a2530",
    kw: "#b6d19a", kwSoft: "#1f2419",
    chipBg: "#26231b", error: "#e07d68", errorBg: "#2e1e18",
    adv: "#b09fda", advSoft: "#221c32",
    eric: "#82c7be", ericSoft: "#132320",
    ct: "#dfa96b", ctSoft: "#2a2013",
    queryBoxBg: "#0d0b07", queryBoxFg: "#f3efe6",
  },
};

const SERIF = `"Fraunces", "Times New Roman", Georgia, serif`;
const SANS  = `"Inter", -apple-system, BlinkMacSystemFont, system-ui, sans-serif`;
const MONO  = `"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace`;

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
  { heading: "01 — Pick a source and find records", body:
    `Switch between PubMed (biomedical literature), ClinicalTrials.gov (registry — a required step in Cochrane/PRISMA systematic reviews), and ERIC (education research) with the source switch.

Search: type any query, results appear 10 at a time.
Advanced: build a field-specific query (Author, MeSH Terms, Publication Type for PubMed; Descriptor/Education Level for ERIC; Condition/Phase/Status for Trials), combining rows with AND/OR/NOT.
Paste: paste a reference list — PMIDs/DOIs (PubMed), EJ/ED numbers (ERIC), or NCT ids (Trials) are most reliable; titles are a best-effort fallback.
MeSH / Thesaurus: a vocabulary explorer — search by heading OR synonym ("heart attack" finds Myocardial Infarction, with the cross-reference shown).` },
  { heading: "02 — Select records and harvest", body:
    `Each card shows title, authors, journal, year, and its MeSH headings / ERIC descriptors / keywords as clickable chips.

Select records by clicking a card, then Harvest from N selected — or click individual chips to harvest one term at a time. Click an author's name to pull up everything they've published.` },
  { heading: "03 — Explore the vocabulary directly", body:
    `In the MeSH/Thesaurus tab, expand any result for its scope note (MeSH), entry terms / Use-For synonyms (addable as keywords), and broader/narrower headings you can click to walk the hierarchy — without leaving the tab. The MeSH pool is shared between PubMed and Trials.` },
  { heading: "04 — Build your search string", body:
    `Boolean: click terms to include them; three operators control keyword/vocab/join logic.
Framework: pick from ten established frameworks (PICO, PICOS, PECO, SPICE, CIMO, SPIDER, PICo, PCC, ECLIPSE, PIRD) or Custom, then drag terms into concept buckets. Both emit syntax for whichever source is active — PubMed bracket tags, ERIC field prefixes, or ClinicalTrials.gov AREA[...] operators.` },
];

// ── Types ──────────────────────────────────────────────────────────────────────
interface VocabDetailsState {
  label: string; vocab: "mesh" | "eric"; loading: boolean;
  scopeNote?: string; terms?: string[]; bt?: string[]; nt?: string[];
}
interface AdvRow { field: string; value: string; op: "AND" | "OR" | "NOT" }
interface AdvField { label: string; tag: string }
interface CustomBucket { key: string; label: string }
type BucketMap = Record<string, string[]>;
// Pool-chip "≈" synonyms panel — distinct from VocabDetailsState (the
// Vocabulary Explorer tab's row details): this one lives on pool chips
// themselves (Harvest tab), has no scope note, and its broader/narrower
// entries add directly to the pool rather than re-centering a search.
interface SynPanelState {
  term: string; vocab: "mesh" | "eric"; loading: boolean;
  terms?: string[]; bt?: string[]; nt?: string[]; missing?: boolean;
}

// ── MCP server call helper ─────────────────────────────────────────────────────
async function callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const result = await mcpApp.callServerTool({ name, arguments: args });
  const text = result.content?.find((c: { type: string }) => c.type === "text") as { text: string } | undefined;
  if (!text) throw new Error(`No text content in ${name} response`);
  return JSON.parse(text.text) as T;
}

// ── SeedMark — the ReviewSeed logo, ported verbatim ────────────────────────────
function SeedMark({ size = 22, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" role="img" aria-label="ReviewSeed" style={{ display: "block", flexShrink: 0 }}>
      <defs>
        <mask id="reviewseed-ribs-mcp">
          <rect width={56} height={56} fill="white" />
          <path d="M 28 9 L 28 47" stroke="black" strokeWidth={1.4} strokeLinecap="round" />
          <path d="M 24 12 C 23 19, 23 37, 25 45" stroke="black" strokeWidth={1.2} fill="none" strokeLinecap="round" />
          <path d="M 32 12 C 33 19, 33 37, 31 45" stroke="black" strokeWidth={1.2} fill="none" strokeLinecap="round" />
        </mask>
      </defs>
      <path d="M 28 6 C 22 7, 17 14, 17 28 C 17 40, 21 50, 28 50 C 35 50, 39 40, 39 28 C 39 14, 34 7, 28 6 Z" fill={color} mask="url(#reviewseed-ribs-mcp)" />
    </svg>
  );
}

// ── Style helpers — ported verbatim from the website ───────────────────────────
const tbBtn = (c: Theme) => ({ padding: "6px 14px", border: `1px solid ${c.line}`, background: c.surface, borderRadius: 4, fontSize: 12, color: c.ink2, cursor: "pointer", fontFamily: SANS, display: "inline-flex", alignItems: "center", gap: 6, letterSpacing: 0.2 } as const);
const inputStyle = (c: Theme) => ({ width: "100%", padding: "10px 12px", background: c.surface, border: `1px solid ${c.line}`, borderRadius: 4, fontSize: 13, color: c.ink, fontFamily: SANS, boxSizing: "border-box" as const });
const primaryBtn = (c: Theme, disabled: boolean) => ({ padding: "10px 16px", background: c.accent, color: "#fff", border: "none", borderRadius: 4, fontSize: 12.5, fontWeight: 500, letterSpacing: 0.3, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.45 : 1, fontFamily: SANS } as const);
function SectionLabel({ c, children }: { c: Theme; children: React.ReactNode }) {
  return <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1.4, textTransform: "uppercase", color: c.ink3, fontFamily: SANS }}>{children}</div>;
}
function segmented<T extends string>(c: Theme, value: T, onChange: (v: T) => void, opts: Array<{ k: T; l: string }>) {
  return (
    <div role="group" style={{ display: "flex", border: `1px solid ${c.line}`, borderRadius: 3, overflow: "hidden" }}>
      {opts.map(o => (
        <button key={o.k} onClick={() => onChange(o.k)} aria-pressed={value === o.k}
          style={{ padding: "4px 12px", background: value === o.k ? c.ink : "transparent", color: value === o.k ? c.surface : c.ink2, border: "none", fontSize: 11, cursor: "pointer", fontFamily: SANS, letterSpacing: 0.3, fontWeight: value === o.k ? 500 : 400 }}>
          {o.l}
        </button>
      ))}
    </div>
  );
}

// ── Chip — matches the site's PoolChip: flat, radius 3, no border ─────────────
type ChipType = "keyword" | "mesh" | "eric" | "query";
function chipColors(c: Theme, type: ChipType, selected: boolean | undefined) {
  const [fg, bg] = type === "mesh" ? [c.mesh, c.meshSoft] : type === "eric" ? [c.eric, c.ericSoft] : type === "query" ? [c.adv, c.advSoft] : [c.kw, c.kwSoft];
  return selected ? { background: fg, color: "#fff" } : { background: bg, color: fg };
}
interface ChipProps {
  c: Theme; term: string; type: ChipType; selected?: boolean; onClick?: () => void;
  draggable?: boolean; onDragStart?: (e: React.DragEvent) => void;
  field?: string; onFieldChange?: (term: string, field: string) => void; onRemove?: (term: string) => void;
  onDetails?: () => void; detailsOpen?: boolean;
}
function Chip({ c, term, type, selected, onClick, draggable, onDragStart, field, onFieldChange, onRemove, onDetails, detailsOpen }: ChipProps) {
  const colors = chipColors(c, type, selected);
  const handleKey = (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); } };
  const border = `1px solid ${colors.color}40`;
  return (
    <span draggable={draggable} onDragStart={onDragStart}
      role={onClick ? "checkbox" : undefined} aria-checked={onClick ? !!selected : undefined}
      aria-label={`${term} (${type})`} tabIndex={onClick ? 0 : undefined} onKeyDown={onClick ? handleKey : undefined}
      style={{ display: "inline-flex", alignItems: "center", margin: 3, borderRadius: 3, fontSize: 11, fontFamily: SANS, ...colors, userSelect: "none", overflow: "hidden" }}>
      <span onClick={onClick} style={{ padding: "3px 3px 3px 9px", cursor: onClick ? "pointer" : "default", lineHeight: 1.35 }}>{term}</span>
      {type === "keyword" && onFieldChange && (
        <select value={field || "tiab"} aria-label={`Search field for ${term}`}
          onChange={e => { e.stopPropagation(); onFieldChange(term, e.target.value); }} onClick={e => e.stopPropagation()}
          style={{ fontSize: 10, fontFamily: MONO, color: colors.color, background: "transparent", border: "none", borderLeft: border, marginLeft: 2, padding: "0 4px", cursor: "pointer", outline: "none" }}>
          {KW_FIELDS.map(f => <option key={f.tag} value={f.tag}>{f.tag}</option>)}
        </select>
      )}
      {onDetails && (
        <button onClick={e => { e.stopPropagation(); onDetails(); }} aria-expanded={detailsOpen}
          aria-pressed={detailsOpen}
          title={`NLM entry terms — synonyms of "${term}"`}
          aria-label={`${detailsOpen ? "Hide" : "Show"} synonyms of ${term}`}
          style={{ background: detailsOpen ? colors.color : "none", border: "none", borderLeft: border, color: detailsOpen ? colors.background : "inherit", padding: "0 6px", cursor: "pointer", fontSize: 11, fontFamily: MONO }}>
          ≈
        </button>
      )}
      {onRemove && (
        <button onClick={e => { e.stopPropagation(); onRemove(term); }} aria-label={`Remove ${term}`}
          style={{ padding: "0 6px", cursor: "pointer", background: "none", border: "none", borderLeft: border, color: "inherit", fontSize: 12, lineHeight: 1, opacity: 0.75 }}>×</button>
      )}
    </span>
  );
}

// ── Query output box — matches the site's near-black code block ───────────────
// MCP Apps render in a sandboxed iframe: raw window.open() is blocked, so
// opening an external link must go through the host via app.openLink(). The
// host may still deny it (user preference/security policy) — surface that
// instead of silently doing nothing.
function QueryBox({ c, query, copied, onCopy, source }: { c: Theme; query: string; copied: boolean; onCopy: () => void; source: Source }) {
  const [linkError, setLinkError] = useState(false);
  const run = async () => {
    setLinkError(false);
    const url = `${SOURCE_HOME[source]}${encodeURIComponent(query.replace(/\n/g, " "))}`;
    try {
      const r = await mcpApp.openLink({ url });
      if (r.isError) setLinkError(true);
    } catch { setLinkError(true); }
  };
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 11, fontFamily: MONO, color: c.ink3, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Search string</div>
      <div aria-live="polite" aria-label="Generated search string"
        style={{ padding: "14px 16px", background: c.queryBoxBg, borderRadius: 4, fontFamily: MONO, fontSize: 12.5, color: c.queryBoxFg, whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.6 }}>
        {query}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button onClick={onCopy} style={{ padding: "9px 18px", background: copied ? c.accent : c.ink, color: c.surface, border: "none", borderRadius: 3, fontSize: 12, cursor: "pointer", fontFamily: SANS, fontWeight: 500, letterSpacing: 0.3 }}>
          {copied ? "Copied to clipboard" : "Copy to Clipboard"}
        </button>
        <button onClick={run}
          style={{ padding: "9px 18px", background: "transparent", color: c.accent, border: `1px solid ${c.accent}`, borderRadius: 3, fontSize: 12, cursor: "pointer", fontFamily: SANS, fontWeight: 500, letterSpacing: 0.3 }}>
          Run in {SOURCE_LABEL[source]}
        </button>
        {linkError && <div role="alert" style={{ fontSize: 11.5, color: c.error, alignSelf: "center" }}>Host blocked opening the link — copy the string above and paste it into {SOURCE_LABEL[source]} directly.</div>}
      </div>
    </div>
  );
}

// ── Pool-chip synonyms panel — the site's "≈" button on MeSH/ERIC pool chips.
// Distinct from the Vocabulary Explorer tab: entry terms/broader/narrower here
// add directly to the pool rather than re-centering a search.
function SynPanel({ c, panel, expanded, setExpanded, pool, onAddKeyword, onAddVocab }: {
  c: Theme; panel: SynPanelState; expanded: { bt?: boolean; nt?: boolean }; setExpanded: React.Dispatch<React.SetStateAction<{ bt?: boolean; nt?: boolean }>>;
  pool: Pool; onAddKeyword: (t: string) => void; onAddVocab: (vocab: "mesh" | "eric", t: string) => void;
}) {
  const isMesh = panel.vocab === "mesh";
  const vocabPool = isMesh ? pool.mesh : pool.eric;
  const vocabColor = isMesh ? c.mesh : c.eric;
  const vocabBg = isMesh ? c.meshSoft : c.ericSoft;

  const kwBtn = (t: string) => {
    const inPool = pool.keywords.includes(t);
    return (
      <button key={t} onClick={() => !inPool && onAddKeyword(t)} aria-disabled={inPool}
        title={inPool ? `${t} is in the keyword pool` : `Add "${t}" to the keyword pool`}
        style={{ padding: "3px 8px", fontSize: 11, fontFamily: MONO, cursor: inPool ? "default" : "pointer", background: inPool ? c.kw : c.kwSoft, color: inPool ? "#fff" : c.kw, border: "none", borderRadius: 2 }}>
        {inPool ? "✓ " : "+ "}{t}
      </button>
    );
  };
  const descBtn = (t: string) => {
    const inPool = vocabPool.includes(t);
    return (
      <button key={t} onClick={() => !inPool && onAddVocab(panel.vocab, t)} aria-disabled={inPool}
        title={inPool ? `${t} is in the ${isMesh ? "MeSH" : "ERIC descriptor"} pool` : `Add "${t}" to the ${isMesh ? "MeSH" : "ERIC descriptor"} pool`}
        style={{ padding: "3px 8px", fontSize: 11, fontFamily: MONO, cursor: inPool ? "default" : "pointer", background: inPool ? vocabColor : vocabBg, color: inPool ? "#fff" : vocabColor, border: "none", borderRadius: 2 }}>
        {inPool ? "✓ " : "+ "}{t}
      </button>
    );
  };
  const hierRow = (label: string, list: string[] | undefined, key: "bt" | "nt") => {
    if (!list?.length) return null;
    const shown = expanded[key] ? list : list.slice(0, 12);
    return (
      <div style={{ marginTop: 6 }}>
        <div style={{ fontSize: 9.5, fontFamily: MONO, color: c.ink3, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 3 }}>{label}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {shown.map(descBtn)}
          {list.length > 12 && (
            <button onClick={() => setExpanded(p => ({ ...p, [key]: !p[key] }))}
              style={{ padding: "3px 8px", fontSize: 10.5, fontFamily: SANS, cursor: "pointer", background: "transparent", color: c.ink3, border: `1px dashed ${c.line}`, borderRadius: 2, letterSpacing: 0.3 }}>
              {expanded[key] ? "less ▲" : `+${list.length - 12} more ▼`}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ marginTop: 8, padding: "8px 10px", background: c.chipBg, border: `1px solid ${c.line}`, borderRadius: 3 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ fontSize: 9.5, fontFamily: MONO, color: c.ink3, letterSpacing: 0.4, textTransform: "uppercase" }}>
          synonyms of {panel.term} · {isMesh ? "NLM entry terms" : "ERIC Thesaurus"}
        </div>
      </div>
      {panel.loading ? (
        <div style={{ fontSize: 11.5, color: c.ink3, fontStyle: "italic" }}>Looking up synonyms…</div>
      ) : panel.missing ? (
        <div style={{ fontSize: 11.5, color: c.ink3, fontStyle: "italic" }}>
          {isMesh ? "Couldn't find this heading in NLM's lookup — no entry terms available." : "Couldn't load the thesaurus snapshot. Check your connection and try again."}
        </div>
      ) : !panel.terms?.length && !panel.bt?.length && !panel.nt?.length ? (
        <div style={{ fontSize: 11.5, color: c.ink3, fontStyle: "italic" }}>
          {isMesh ? "NLM lists no entry terms or hierarchy for this heading." : "The Thesaurus lists no synonyms or broader/narrower terms for this descriptor."}
        </div>
      ) : (
        <>
          {!!panel.terms?.length && <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{panel.terms.map(kwBtn)}</div>}
          {hierRow("broader descriptors", panel.bt, "bt")}
          {hierRow("narrower descriptors", panel.nt, "nt")}
        </>
      )}
    </div>
  );
}

// ── Vocabulary Explorer ─────────────────────────────────────────────────────────
interface VocabExplorerProps { c: Theme; source: Source; pool: Pool; onAddKeyword: (t: string) => void; onAddVocab: (t: string) => void }
function VocabExplorer({ c, source, pool, onAddKeyword, onAddVocab }: VocabExplorerProps) {
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
        aria-label={`Search ${vocab === "mesh" ? "MeSH" : "ERIC Thesaurus"}`} style={inputStyle(c)} />
      <div style={{ marginTop: 6, fontSize: 10.5, color: c.ink3, fontFamily: MONO, letterSpacing: 0.3 }}>headings &amp; entry terms · expand a row for scope note, synonyms, hierarchy</div>
      <div role="status" aria-live="polite" style={{ marginTop: 8, maxHeight: 320, overflowY: "auto" }}>
        {loading && <div style={{ fontSize: 12, color: c.ink3, padding: "4px 0" }}>Searching…</div>}
        {err && <div role="alert" style={{ fontSize: 12, color: c.error }}>{err}</div>}
        {!loading && !err && query.trim().length >= 2 && rows.length === 0 && (
          <div style={{ fontSize: 12, color: c.ink3, fontStyle: "italic" }}>No headings or entry terms match "{query}".</div>
        )}
        {rows.map(row => {
          const inPool = vocabPool.includes(row.label);
          const open = details?.label === row.label;
          return (
            <div key={row.id ?? row.label} style={{ padding: "8px 0", borderBottom: `1px solid ${c.line}` }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 12.5, color: c.ink, lineHeight: 1.35 }}>{row.label}</div>
                  {row.via && <div style={{ fontSize: 10.5, color: c.ink3, fontStyle: "italic", marginTop: 1 }}>matched "{row.via}" → use {row.label}</div>}
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button onClick={() => toggleDetails(row)} aria-expanded={open}
                    style={{ fontSize: 10, padding: "3px 7px", fontFamily: SANS, background: "transparent", color: c.ink3, border: `1px solid ${c.line}`, borderRadius: 3, cursor: "pointer", letterSpacing: 0.3 }}>
                    {open ? "details ▴" : "details ▾"}
                  </button>
                  <button aria-disabled={inPool} onClick={() => !inPool && onAddVocab(row.label)}
                    style={{ fontSize: 10, padding: "3px 9px", fontFamily: SANS, background: "transparent", color: inPool ? c.ink3 : c.mesh, border: `1px solid ${inPool ? c.line : c.mesh}`, borderRadius: 3, cursor: inPool ? "default" : "pointer", fontWeight: 500, letterSpacing: 0.5, textTransform: "uppercase" }}>
                    {inPool ? "Added" : "Add"}
                  </button>
                </div>
              </div>
              {open && (
                <div style={{ marginTop: 6, padding: "8px 10px", background: c.chipBg, borderRadius: 3 }}>
                  {details?.loading ? <div style={{ fontSize: 11.5, color: c.ink3, fontStyle: "italic" }}>Looking up details…</div> : (
                    <>
                      {details?.scopeNote && <div style={{ fontSize: 11.5, color: c.ink2, lineHeight: 1.5, marginBottom: 6 }}>{details.scopeNote}</div>}
                      {!!details?.terms?.length && (
                        <div style={{ marginBottom: 6 }}>
                          <div style={{ fontSize: 9.5, fontFamily: MONO, color: c.ink3, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 3 }}>{vocab === "mesh" ? "entry terms" : "use for (synonyms)"}</div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{details.terms.map(t => <Chip key={t} c={c} term={t} type="keyword" onClick={() => onAddKeyword(t)} />)}</div>
                        </div>
                      )}
                      {!!details?.bt?.length && (
                        <div style={{ marginBottom: 6 }}>
                          <div style={{ fontSize: 9.5, fontFamily: MONO, color: c.ink3, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 3 }}>broader</div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{details.bt.map(t => <button key={t} onClick={() => runSearch(t)} style={{ padding: "3px 8px", fontSize: 11, fontFamily: MONO, cursor: "pointer", background: "transparent", color: c.ink2, border: `1px solid ${c.line}`, borderRadius: 2 }}>{t}</button>)}</div>
                        </div>
                      )}
                      {!!details?.nt?.length && (
                        <div>
                          <div style={{ fontSize: 9.5, fontFamily: MONO, color: c.ink3, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 3 }}>narrower</div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{details.nt.map(t => <button key={t} onClick={() => runSearch(t)} style={{ padding: "3px 8px", fontSize: 11, fontFamily: MONO, cursor: "pointer", background: "transparent", color: c.ink2, border: `1px solid ${c.line}`, borderRadius: 2 }}>{t}</button>)}</div>
                        </div>
                      )}
                      {!details?.scopeNote && !details?.terms?.length && !details?.bt?.length && !details?.nt?.length && (
                        <div style={{ fontSize: 11.5, color: c.ink3, fontStyle: "italic" }}>No additional detail for this heading.</div>
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
interface AdvancedSearchProps { c: Theme; source: Source; onRun: (query: string) => void; onAddToPool: (query: string) => void; loading: boolean }
function AdvancedSearch({ c, source, onRun, onAddToPool, loading }: AdvancedSearchProps) {
  const [fields, setFields] = useState<AdvField[]>([]);
  const [rows, setRows] = useState<AdvRow[]>([{ field: "", value: "", op: "AND" }]);

  useEffect(() => {
    setRows([{ field: "", value: "", op: "AND" }]);
    callTool<{ fields: AdvField[] }>("reviewseed_advanced_search", { source, rows: [] })
      .then(r => setFields(r.fields)).catch(() => setFields([]));
  }, [source]);

  const setRow = (i: number, patch: Partial<AdvRow>) => setRows(p => p.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const addRow = () => setRows(p => [...p, { field: fields[0]?.tag ?? "all", value: "", op: "AND" }]);
  const removeRow = (i: number) => setRows(p => p.filter((_, idx) => idx !== i));

  const validRows = rows.filter(r => r.value.trim() && r.field);
  const assemble = async (run: boolean) => {
    const r = await callTool<{ query: string }>("reviewseed_advanced_search", { source, rows: validRows.map(r => ({ field: r.field, value: r.value, op: r.op })), run: false });
    if (run) onRun(r.query); else onAddToPool(r.query);
  };
  const rowSelectStyle = { flex: "0 0 170px", fontSize: 12, fontFamily: SANS, borderRadius: 4, border: `1px solid ${c.line}`, padding: "6px 4px", background: c.surface, color: c.ink } as const;

  return (
    <div>
      {rows.map((row, i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
          {i > 0 && (
            <select value={row.op} onChange={e => setRow(i, { op: e.target.value as AdvRow["op"] })} style={{ ...rowSelectStyle, flex: "0 0 66px" }}>
              <option>AND</option><option>OR</option><option>NOT</option>
            </select>
          )}
          <select value={row.field} onChange={e => setRow(i, { field: e.target.value })} style={rowSelectStyle}>
            <option value="">Field…</option>
            {fields.map(f => <option key={f.tag} value={f.tag}>{f.label}</option>)}
          </select>
          <input value={row.value} onChange={e => setRow(i, { value: e.target.value })} placeholder="value"
            style={{ flex: 1, fontSize: 13, padding: "6px 10px", borderRadius: 4, border: `1px solid ${c.line}`, color: c.ink, background: c.surface, fontFamily: SANS }} />
          {rows.length > 1 && <button onClick={() => removeRow(i)} aria-label="Remove row" style={{ background: "none", border: "none", color: c.ink3, cursor: "pointer", fontSize: 16 }}>×</button>}
        </div>
      ))}
      <button onClick={addRow} style={tbBtn(c)}>+ Add row</button>
      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
        <button disabled={!validRows.length || loading} onClick={() => assemble(true)} style={primaryBtn(c, !validRows.length || loading)}>
          {loading ? "Searching…" : `Search ${SOURCE_LABEL[source]}`}
        </button>
        <button disabled={!validRows.length} onClick={() => assemble(false)}
          style={{ padding: "10px 16px", background: "transparent", color: c.accent, border: `1px solid ${c.accent}`, borderRadius: 4, cursor: validRows.length ? "pointer" : "not-allowed", fontWeight: 500, fontSize: 12.5, fontFamily: SANS, opacity: validRows.length ? 1 : 0.45 }}>
          Add to pool
        </button>
      </div>
    </div>
  );
}

// ── Boolean Builder ────────────────────────────────────────────────────────────
interface BuilderProps { c: Theme; source: Source; pool: Pool; kwFields: Record<string, string>; onFieldChange?: (t: string, f: string) => void }
function BooleanBuilder({ c, source, pool, kwFields, onFieldChange }: BuilderProps) {
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
  const opSelect = { fontSize: 12, fontFamily: SANS, borderRadius: 4, border: `1px solid ${c.line}`, padding: "3px 6px", color: c.ink, background: c.surface } as const;

  return (
    <div>
      <p style={{ fontSize: 13, color: c.ink2, marginTop: 0, fontFamily: SANS }}>Click terms to include them in the search string.</p>
      {pool.keywords.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 9.5, fontFamily: MONO, color: c.ink3, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 4 }}>Keywords</div>
          <div style={{ display: "flex", flexWrap: "wrap" }}>{pool.keywords.map(t => <Chip key={t} c={c} term={t} type="keyword" selected={selKw.has(t)} onClick={() => toggle(setSelKw)(t)} field={kwFields[t]} onFieldChange={onFieldChange} />)}</div>
        </div>
      )}
      {vocabPool.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 9.5, fontFamily: MONO, color: c.ink3, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 4 }}>{source === "eric" ? "ERIC Descriptors" : "MeSH Headings"}</div>
          <div style={{ display: "flex", flexWrap: "wrap" }}>{vocabPool.map(t => <Chip key={t} c={c} term={t} type={vocabType} selected={selVocab.has(t)} onClick={() => toggle(setSelVocab)(t)} />)}</div>
        </div>
      )}
      {queryPool.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 9.5, fontFamily: MONO, color: c.ink3, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 4 }}>Advanced-search snippets</div>
          <div style={{ display: "flex", flexWrap: "wrap" }}>{queryPool.map(t => <Chip key={t} c={c} term={t} type="query" selected={selQ.has(t)} onClick={() => toggle(setSelQ)(t)} />)}</div>
        </div>
      )}
      {(selKw.size > 0 || selVocab.size > 0) && (
        <div style={{ display: "flex", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
          <label style={{ fontSize: 11, fontFamily: SANS, color: c.ink2 }}>Keyword op <select value={kwOp} onChange={e => setKwOp(e.target.value as any)} style={opSelect}><option>OR</option><option>AND</option></select></label>
          <label style={{ fontSize: 11, fontFamily: SANS, color: c.ink2 }}>Vocab op <select value={vocabOp} onChange={e => setVocabOp(e.target.value as any)} style={opSelect}><option>OR</option><option>AND</option></select></label>
          <label style={{ fontSize: 11, fontFamily: SANS, color: c.ink2 }}>Join <select value={joinOp} onChange={e => setJoinOp(e.target.value as any)} style={opSelect}><option>AND</option><option>OR</option></select></label>
        </div>
      )}
      {query && <QueryBox c={c} query={query} copied={copied} onCopy={copy} source={source} />}
    </div>
  );
}

// ── Framework Builder ──────────────────────────────────────────────────────────
function FrameworkBuilder({ c, source, pool, kwFields }: BuilderProps) {
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
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        <select value={fwKey} onChange={e => { setFwKey(e.target.value); setBuckets({}); }}
          style={{ fontSize: 13, fontFamily: SERIF, fontWeight: 500, padding: "6px 10px", borderRadius: 4, border: `1px solid ${c.line}`, color: c.ink, background: c.surface }}>
          {Object.entries(FRAMEWORKS).map(([k, f]) => <option key={k} value={k}>{f.label} — {f.tag}</option>)}
        </select>
        <span style={{ fontSize: 11.5, color: c.ink3, fontFamily: SANS }}>{fw.full}</span>
      </div>
      <p style={{ fontSize: 12, color: c.ink3, marginTop: 0, fontFamily: SANS }}>{fw.blurb} Drag terms into a bucket; terms within a bucket are OR'd, buckets are AND'd.</p>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 9.5, fontFamily: MONO, color: c.ink3, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 6 }}>Term pool — drag to a bucket</div>
        <div style={{ minHeight: 36, padding: 6, background: c.chipBg, borderRadius: 4, border: `1px dashed ${c.line}` }}>
          {unplaced.length === 0 && <span style={{ fontSize: 12, color: c.ink3, padding: "4px 8px" }}>All terms placed, or no terms harvested yet.</span>}
          <div style={{ display: "flex", flexWrap: "wrap" }}>{unplaced.map(t => <Chip key={t} c={c} term={t} type={termType(t)} draggable onDragStart={e => { e.dataTransfer.effectAllowed = "move"; setDragTerm(t); }} />)}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        {fw.buckets.map(b => (
          <div key={b.key} onDragOver={e => e.preventDefault()} onDrop={dropInto(b.key)}
            style={{ border: `1px dashed ${c.line}`, borderRadius: 4, padding: 10, minHeight: 64, background: c.bg }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              {fwKey === "Custom" ? (
                <input value={b.label} onChange={e => renameCustomBucket(b.key, e.target.value)}
                  style={{ fontSize: 11, fontFamily: SANS, fontWeight: 700, color: c.accent, border: "none", background: "transparent", width: "70%", textTransform: "uppercase", letterSpacing: 0.5 }} />
              ) : <div style={{ fontSize: 11, fontFamily: SANS, fontWeight: 700, color: c.accent, textTransform: "uppercase", letterSpacing: 0.5 }}>{b.label}</div>}
              {fwKey === "Custom" && customBuckets.length > 1 && <button onClick={() => removeCustomBucket(b.key)} style={{ background: "none", border: "none", color: c.ink3, cursor: "pointer" }}>×</button>}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap" }}>{(buckets[b.key] ?? []).map(t => <Chip key={t} c={c} term={t} type={termType(t)} selected onRemove={() => removeFrom(b.key, t)} />)}</div>
            {!(buckets[b.key] ?? []).length && <span style={{ fontSize: 11.5, color: c.ink3, fontStyle: "italic" }}>Drop terms here</span>}
          </div>
        ))}
      </div>
      {fwKey === "Custom" && customBuckets.length < 6 && <button onClick={addCustomBucket} style={{ ...tbBtn(c), marginBottom: 10 }}>+ Add concept</button>}

      {query && <QueryBox c={c} query={query} copied={copied} onCopy={copy} source={source} />}
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────────
function ReviewSeed() {
  const [dark, setDark] = useState(false);
  const c: Theme = dark ? T.dark : T.light;

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
  const [synPanel, setSynPanel] = useState<SynPanelState | null>(null);
  const [synExpanded, setSynExpanded] = useState<{ bt?: boolean; nt?: boolean }>({});

  useEffect(() => { mcpApp.connect(); }, []);
  useEffect(() => { setQuery(""); setPasteText(""); setArticles([]); setSelected(new Set()); setError(""); setPage(1); }, [source, mode]);

  const setField = (term: string, field: string) => setKwFields(p => ({ ...p, [term]: field }));
  const poolKey = (t: "keyword" | "vocab" | "query"): keyof Pool =>
    t === "keyword" ? "keywords" : t === "vocab" ? (source === "eric" ? "eric" : "mesh") : (source === "eric" ? "ericQueries" : source === "trials" ? "ctQueries" : "queries");
  const addToPool = (t: "keyword" | "vocab" | "query", term: string) => setPool(p => { const key = poolKey(t); return p[key].includes(term) ? p : { ...p, [key]: [...p[key], term] }; });
  // Vocab-explicit variants for the synonyms panel — a MeSH/ERIC broader/
  // narrower term always belongs to that vocab's pool regardless of which
  // source is currently toggled (the Harvest tab shows all pools at once).
  const addKeyword = (term: string) => setPool(p => p.keywords.includes(term) ? p : { ...p, keywords: [...p.keywords, term] });
  const addVocabTerm = (vocab: "mesh" | "eric", term: string) => setPool(p => p[vocab].includes(term) ? p : { ...p, [vocab]: [...p[vocab], term] });

  // "≈" synonyms panel on pool chips — entry terms + broader/narrower for a
  // harvested MeSH/ERIC term, sourced from the same tool the Vocabulary
  // Explorer tab uses, but surfaced right on the pool chip that grew it.
  const showSynonyms = async (term: string, vocab: "mesh" | "eric") => {
    if (synPanel?.term === term && synPanel?.vocab === vocab) { setSynPanel(null); return; }
    setSynPanel({ term, vocab, loading: true });
    setSynExpanded({});
    try {
      const d = await callTool<{ terms: string[]; bt: string[]; nt: string[]; error?: string }>("reviewseed_vocab_details", { vocab, label: term });
      setSynPanel(p => (p?.term === term && p?.vocab === vocab) ? { term, vocab, loading: false, terms: d.terms, bt: d.bt, nt: d.nt, missing: !!d.error } : p);
    } catch {
      setSynPanel(p => (p?.term === term && p?.vocab === vocab) ? { term, vocab, loading: false, terms: [], bt: [], nt: [], missing: true } : p);
    }
  };

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

  return (
    <div style={{ minHeight: "100vh", background: c.bg, color: c.ink, fontFamily: SANS }}>
      {guideOpen && (
        <div role="dialog" aria-modal="true" aria-labelledby="guide-title" style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", background: dark ? "rgba(0,0,0,0.65)" : "rgba(20,17,13,0.45)", padding: "40px 16px 24px", overflowY: "auto" }}>
          <div style={{ background: c.surface, borderRadius: 6, width: "100%", maxWidth: 680, border: `1px solid ${c.line}`, boxShadow: "0 24px 80px rgba(0,0,0,0.25)" }}>
            <div style={{ padding: "18px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${c.line}` }}>
              <h2 id="guide-title" style={{ margin: 0, color: c.ink, fontSize: 22, fontFamily: SERIF, fontWeight: 500, letterSpacing: -0.3 }}>User Guide</h2>
              <button onClick={() => setGuideOpen(false)} aria-label="Close" style={{ background: "transparent", border: `1px solid ${c.line}`, color: c.ink2, borderRadius: 4, width: 32, height: 32, cursor: "pointer" }}>×</button>
            </div>
            <div style={{ padding: "24px 28px 32px", maxHeight: "70vh", overflowY: "auto" }}>
              {GUIDE.map((s, i) => (
                <section key={i} style={{ marginBottom: 24 }}>
                  <h3 style={{ margin: "0 0 8px", color: c.ink, fontSize: 14, fontFamily: SERIF, fontWeight: 500, borderBottom: `1px solid ${c.line}`, paddingBottom: 6 }}>{s.heading}</h3>
                  <p style={{ margin: 0, fontSize: 13, color: c.ink2, lineHeight: 1.7, whiteSpace: "pre-line", fontFamily: SANS }}>{s.body}</p>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}

      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: `1px solid ${c.line}`, position: "sticky", top: 0, background: c.bg, zIndex: 10, gap: 8 }}>
        <div onClick={() => setAboutOpen(o => !o)} title="About ReviewSeed" style={{ display: "flex", alignItems: "center", gap: 0, cursor: "pointer", userSelect: "none" }}>
          <SeedMark size={20} color={c.accent} />
          <div style={{ fontFamily: SERIF, fontSize: 20, fontWeight: 500, letterSpacing: -0.5, color: c.ink }}>
            Review<span style={{ color: c.accent, fontStyle: "italic", fontWeight: 400 }}>Seed</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={() => setAboutOpen(o => !o)} aria-expanded={aboutOpen} style={tbBtn(c)}>About</button>
          <button onClick={() => setGuideOpen(true)} aria-haspopup="dialog" style={tbBtn(c)}>Guide</button>
          <button onClick={() => setDark(!dark)} aria-label="Toggle dark mode" style={{ width: 32, height: 32, border: `1px solid ${c.line}`, background: c.surface, borderRadius: 4, color: c.ink2, cursor: "pointer", fontSize: 13 }}>
            {dark ? "☀" : "☾"}
          </button>
        </div>
      </header>

      {aboutOpen && (
        <div style={{ background: c.ink, color: c.bg, borderBottom: `1px solid ${c.line}` }}>
          <div style={{ padding: "24px 20px" }}>
            <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.8, fontFamily: SERIF, fontStyle: "italic", fontWeight: 400 }}>
              ReviewSeed builds systematic and scoping review search strings across PubMed, ClinicalTrials.gov, and ERIC.
              Search or paste citations to harvest each source's real controlled vocabulary and keywords, explore MeSH or
              the ERIC Thesaurus directly (synonyms, scope notes, broader/narrower hierarchy), then assemble a Boolean or
              ten-framework (PICO, PECO, SPIDER, PCC, and more) search string in the target database's own syntax. All
              calls go through the MCP server to each database's public API — no data is stored.
            </p>
          </div>
        </div>
      )}

      <main style={{ padding: "20px 18px 32px" }}>
        {/* Source switcher */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
          <SectionLabel c={c}>01 — Find records</SectionLabel>
          {segmented(c, source, setSource, [{ k: "pubmed", l: "PubMed" }, { k: "trials", l: "Trials" }, { k: "eric", l: "ERIC" }])}
        </div>

        {/* Mode tabs — underline style, matching the site */}
        <div style={{ display: "flex", gap: 0, marginBottom: 16, borderBottom: `1px solid ${c.line}` }}>
          {([["search", "Search"], ["advanced", "Advanced"], ["paste", "Paste"], ["vocab", source === "eric" ? "Thesaurus" : "MeSH"]] as [Mode, string][]).map(([m, label]) => (
            <button key={m} onClick={() => setMode(m)} aria-current={mode === m ? "page" : undefined}
              style={{ padding: "9px 0", marginRight: 16, background: "none", border: "none", fontSize: 13, fontFamily: SANS, cursor: "pointer", color: mode === m ? c.ink : c.ink3, fontWeight: mode === m ? 500 : 400, borderBottom: mode === m ? `1.5px solid ${m === "advanced" ? c.adv : c.accent}` : "1.5px solid transparent", marginBottom: -1, letterSpacing: 0.1 }}>
              {label}
            </button>
          ))}
        </div>

        <div style={{ marginBottom: 20 }}>
          {mode === "search" && (
            <div>
              <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && doSearch(1)}
                placeholder={source === "eric" ? "e.g. reading intervention elementary" : source === "trials" ? "e.g. asthma inhaled corticosteroid" : "e.g. burnout clinicians mindfulness"}
                aria-label={`Search ${SOURCE_LABEL[source]}`} style={inputStyle(c)} />
              <button onClick={() => doSearch(1)} disabled={loading || !query.trim()} style={{ ...primaryBtn(c, loading || !query.trim()), marginTop: 12, width: "100%" }}>
                {loading ? "Searching…" : `Search ${SOURCE_LABEL[source]}`}
              </button>
            </div>
          )}
          {mode === "advanced" && (
            <AdvancedSearch c={c} source={source} loading={loading}
              onRun={async q => { setQuery(q); setLoading(true); setSelected(new Set()); try { applyResult(await callTool("reviewseed_search", { source, query: q, page: 1, pageSize: 10 })); setPage(1); } catch { setError("Search failed."); } setLoading(false); }}
              onAddToPool={q => addToPool("query", q)} />
          )}
          {mode === "paste" && (
            <div>
              <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} rows={6}
                placeholder="Paste a reference list. PMID: 30567716 / EJ1234567 / NCT01234567 / 10.1007/s10459-018-9865-9 — or plain text references."
                aria-label="Paste citations"
                style={{ width: "100%", padding: "10px 12px", background: c.surface, border: `1px solid ${c.line}`, borderRadius: 4, fontSize: 12, color: c.ink, fontFamily: MONO, boxSizing: "border-box", lineHeight: 1.55, resize: "none" }} />
              <button onClick={doLookup} disabled={loading || !pasteText.trim()} style={{ ...primaryBtn(c, loading || !pasteText.trim()), marginTop: 12 }}>
                {loading ? "Looking up…" : "Look Up Citations"}
              </button>
            </div>
          )}
          {mode === "vocab" && <VocabExplorer c={c} source={source} pool={pool} onAddKeyword={t => addToPool("keyword", t)} onAddVocab={t => addToPool("vocab", t)} />}

          {error && <div role="alert" style={{ marginTop: 10, padding: "8px 12px", background: c.errorBg, borderRadius: 3, color: c.error, fontSize: 12, fontWeight: 500 }}>{error}</div>}
        </div>

        {mode !== "vocab" && articles.length > 0 && (
          <section style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
              <div style={{ fontFamily: SERIF, fontSize: 17, fontWeight: 500, color: c.ink }}>Results <span style={{ fontFamily: SANS, fontWeight: 400, fontSize: 12.5, color: c.ink3 }}>({total} total · {selected.size} selected)</span></div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setSelected(new Set(articles.map(a => a.pmid)))} style={tbBtn(c)}>Select All</button>
                <button onClick={() => setSelected(new Set())} style={tbBtn(c)}>Clear</button>
                <button onClick={harvestSelected} disabled={!selected.size}
                  style={{ fontSize: 12, padding: "6px 14px", background: selected.size ? c.ink : c.line, color: c.surface, border: "none", borderRadius: 4, cursor: selected.size ? "pointer" : "not-allowed", fontWeight: 500, fontFamily: SANS, letterSpacing: 0.2 }}>
                  Harvest from {selected.size}
                </button>
              </div>
            </div>
            {articles.map(a => {
              const sel = selected.has(a.pmid);
              return (
                <div key={a.pmid} onClick={() => setSelected(p => { const n = new Set(p); n.has(a.pmid) ? n.delete(a.pmid) : n.add(a.pmid); return n; })}
                  role="checkbox" aria-checked={sel} tabIndex={0}
                  style={{ border: `1px solid ${sel ? c.accent : c.line}`, borderRadius: 4, padding: "12px 14px", marginBottom: 8, cursor: "pointer", background: sel ? c.accentSoft : c.surface }}>
                  <div style={{ fontFamily: SERIF, fontSize: 14.5, fontWeight: 500, color: c.ink, marginBottom: 3, lineHeight: 1.4, letterSpacing: -0.1 }}>{a.title}</div>
                  <div style={{ fontSize: 11.5, color: c.ink3, marginBottom: 6, fontFamily: SANS }}>
                    {a.authors.map((name, i) => (
                      <span key={name}>
                        {i > 0 && ", "}
                        <button onClick={e => { e.stopPropagation(); doAuthorSearch(name); }} style={{ background: "none", border: "none", padding: 0, color: c.ink3, textDecoration: "underline", cursor: "pointer", fontSize: 11.5, fontFamily: SANS }}>{name}</button>
                      </span>
                    ))}
                    {" "}· {a.journal}{a.year ? ` (${a.year})` : ""} · {a.pmid}{a.ctStatus ? ` · ${a.ctStatus}` : ""}
                  </div>
                  {(a.keywords.length > 0 || a.mesh.length > 0 || a.eric.length > 0) && (
                    <div onClick={e => e.stopPropagation()} style={{ display: "flex", flexWrap: "wrap" }}>
                      {a.keywords.map(t => <Chip key={t} c={c} term={t} type="keyword" selected={pool.keywords.includes(t)} onClick={() => addToPool("keyword", t)} />)}
                      {a.mesh.map(t => <Chip key={t} c={c} term={t} type="mesh" selected={pool.mesh.includes(t)} onClick={() => addToPool("vocab", t)} />)}
                      {a.eric.map(t => <Chip key={t} c={c} term={t} type="eric" selected={pool.eric.includes(t)} onClick={() => addToPool("vocab", t)} />)}
                    </div>
                  )}
                </div>
              );
            })}
            {mode === "search" && (
              <div style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 8 }}>
                <button onClick={() => doSearch(page - 1)} disabled={page <= 1 || loading} style={{ padding: "4px 10px", border: `1px solid ${c.line}`, borderRadius: 3, background: c.surface, color: c.ink2, cursor: page > 1 ? "pointer" : "default", fontFamily: SANS, fontSize: 12 }}>← Prev</button>
                <span style={{ fontSize: 11.5, padding: "0 4px", color: c.ink3, fontFamily: MONO }}>p.{page}{page >= 5 ? " (max)" : ""}</span>
                <button onClick={() => doSearch(page + 1)} disabled={page >= 5 || loading} style={{ padding: "4px 10px", border: `1px solid ${c.line}`, borderRadius: 3, background: c.surface, color: c.ink2, cursor: page < 5 ? "pointer" : "default", fontFamily: SANS, fontSize: 12 }}>Next →</button>
              </div>
            )}
          </section>
        )}

        <section>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            <SectionLabel c={c}>04 — Build the search string</SectionLabel>
            {segmented(c, tab === "harvest" ? "harvest" : tab, (t: Tab) => setTab(t), [{ k: "harvest" as Tab, l: `Pool${totalHarvested ? ` (${totalHarvested})` : ""}` }, { k: "boolean" as Tab, l: "Boolean" }, { k: "framework" as Tab, l: "Framework" }])}
          </div>
          {tab === "harvest" && (
            totalHarvested === 0 ? (
              <div style={{ padding: "32px 20px", textAlign: "center", border: `1px dashed ${c.line}`, borderRadius: 4, fontSize: 13, color: c.ink3, fontStyle: "italic" }}>
                Your pool is empty. Harvest terms from records above, or use the vocabulary tab to add headings directly.
              </div>
            ) : (
              <>
                {pool.keywords.length > 0 && <div style={{ marginBottom: 14 }}><div style={{ fontSize: 9.5, fontFamily: MONO, color: c.ink3, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 4 }}>Keywords ({pool.keywords.length})</div><div style={{ display: "flex", flexWrap: "wrap" }}>{pool.keywords.map(t => <Chip key={t} c={c} term={t} type="keyword" field={kwFields[t]} onFieldChange={setField} onRemove={t => setPool(p => ({ ...p, keywords: p.keywords.filter(x => x !== t) }))} />)}</div></div>}
                {pool.mesh.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 9.5, fontFamily: MONO, color: c.ink3, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 4 }}>MeSH Headings ({pool.mesh.length})</div>
                    <div style={{ display: "flex", flexWrap: "wrap" }}>
                      {pool.mesh.map(t => (
                        <Chip key={t} c={c} term={t} type="mesh"
                          onDetails={() => showSynonyms(t, "mesh")} detailsOpen={synPanel?.term === t && synPanel?.vocab === "mesh"}
                          onRemove={t => setPool(p => ({ ...p, mesh: p.mesh.filter(x => x !== t) }))} />
                      ))}
                    </div>
                    {synPanel?.vocab === "mesh" && <SynPanel c={c} panel={synPanel} expanded={synExpanded} setExpanded={setSynExpanded} pool={pool} onAddKeyword={addKeyword} onAddVocab={addVocabTerm} />}
                  </div>
                )}
                {pool.eric.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 9.5, fontFamily: MONO, color: c.ink3, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 4 }}>ERIC Descriptors ({pool.eric.length})</div>
                    <div style={{ display: "flex", flexWrap: "wrap" }}>
                      {pool.eric.map(t => (
                        <Chip key={t} c={c} term={t} type="eric"
                          onDetails={() => showSynonyms(t, "eric")} detailsOpen={synPanel?.term === t && synPanel?.vocab === "eric"}
                          onRemove={t => setPool(p => ({ ...p, eric: p.eric.filter(x => x !== t) }))} />
                      ))}
                    </div>
                    {synPanel?.vocab === "eric" && <SynPanel c={c} panel={synPanel} expanded={synExpanded} setExpanded={setSynExpanded} pool={pool} onAddKeyword={addKeyword} onAddVocab={addVocabTerm} />}
                  </div>
                )}
                {([["queries", "PubMed advanced snippets"], ["ericQueries", "ERIC advanced snippets"], ["ctQueries", "Trials advanced snippets"]] as [keyof Pool, string][]).map(([key, label]) => pool[key].length > 0 && (
                  <div key={key} style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 9.5, fontFamily: MONO, color: c.ink3, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 4 }}>{label} ({pool[key].length})</div>
                    <div style={{ display: "flex", flexWrap: "wrap" }}>{pool[key].map((t: string) => <Chip key={t} c={c} term={t} type="query" onRemove={r => setPool(p => ({ ...p, [key]: p[key].filter((x: string) => x !== r) }))} />)}</div>
                  </div>
                ))}
              </>
            )
          )}
          {tab === "boolean" && (totalHarvested === 0 ? <p style={{ fontSize: 13, color: c.ink3, fontStyle: "italic" }}>Harvest some terms first.</p> : <BooleanBuilder c={c} source={source} pool={pool} kwFields={kwFields} onFieldChange={setField} />)}
          {tab === "framework" && (totalHarvested === 0 ? <p style={{ fontSize: 13, color: c.ink3, fontStyle: "italic" }}>Harvest some terms first, then drag them into a framework's buckets here.</p> : <FrameworkBuilder c={c} source={source} pool={pool} kwFields={kwFields} />)}
        </section>
      </main>

      <footer style={{ padding: "16px 18px 24px", borderTop: `1px solid ${c.line}`, fontSize: 11, color: c.ink3, fontFamily: SANS }}>
        ReviewSeed MCP App · queries PubMed, ClinicalTrials.gov, and ERIC's public APIs directly · no data is stored
      </footer>
    </div>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<ReviewSeed />);
