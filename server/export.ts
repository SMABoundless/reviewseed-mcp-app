// Screening handoff: RIS / BibTeX / CSV (docs/REPORTS-ROADMAP.md §3.12).
//
// SHARED LOGIC. The website has a behavioral twin (index.html's page-globals
// toRis / toBibtex / toCsv / dedupeRecords / prismaCounts) and both run
// tests/fixtures/export-parity.json.
//
// PURE: records in, text out.
//
// These files are eaten by other people's software — Covidence, Rayyan, Zotero,
// EndNote — so the format details are the feature. Three of them bit hard enough
// to be worth naming here:
//
//   1. RIS tags are `XX  - value` with TWO spaces before the dash, and records
//      end with a bare `ER  -`. Importers are unforgiving about both.
//   2. RIS wants CRLF. Covidence and EndNote historically choke on bare LF.
//   3. BibTeX must brace-protect a title (`{{...}}`) or BibTeX lowercases it,
//      and backslash-escape the characters TeX treats as syntax.
//
// The website's PubMed records omit `src` and `url` (its render layer fills them
// in) — a documented divergence — so nothing here may assume those exist.
import type { Article, Source } from "./types.js";

/** Records as they arrive from any of the three adapters, with optional extras. */
export type ExportRecord = Partial<Article> & { pmid: string };

const CRLF = "\r\n";

/**
 * RIS reference type. ERIC accessions carry it in the prefix: EJ is a journal
 * article, ED is a document (report, conference paper, dissertation). Getting
 * this wrong sends a report into a screening tool labelled as a journal article.
 */
export function risType(rec: ExportRecord, source?: Source): string {
  const src = rec.src ?? source;
  if (src === "trials") return "RPRT";                     // a registration, not a paper
  if (/^ED/i.test(rec.pmid)) return "RPRT";                // ERIC document
  return "JOUR";
}

const risLine = (tag: string, value: string) => `${tag}  - ${value}`;

/** One RIS record. Empty fields are omitted rather than emitted blank. */
function risRecord(rec: ExportRecord, source?: Source): string {
  const lines: string[] = [risLine("TY", risType(rec, source))];
  if (rec.title) lines.push(risLine("TI", rec.title));
  for (const a of rec.authors ?? []) lines.push(risLine("AU", a));
  if (rec.journal) lines.push(risLine("T2", rec.journal));
  if (rec.year) lines.push(risLine("PY", rec.year));
  if (rec.abstract) lines.push(risLine("AB", rec.abstract.replace(/[\r\n]+/g, " ").trim()));
  if (rec.doi) lines.push(risLine("DO", rec.doi));
  if (rec.pmid) lines.push(risLine("AN", rec.pmid));
  const db = (rec.src ?? source) === "eric" ? "ERIC"
    : (rec.src ?? source) === "trials" ? "ClinicalTrials.gov"
    : "PubMed";
  lines.push(risLine("DB", db));
  for (const k of rec.keywords ?? []) lines.push(risLine("KW", k));
  for (const m of rec.mesh ?? []) lines.push(risLine("KW", m));
  for (const e of rec.eric ?? []) lines.push(risLine("KW", e));
  if (rec.url) lines.push(risLine("UR", rec.url));
  lines.push("ER  - ");
  return lines.join(CRLF);
}

export function toRis(records: ExportRecord[], source?: Source): string {
  if (!records.length) return "";
  return records.map(r => risRecord(r, source)).join(CRLF + CRLF) + CRLF;
}

// ── BibTeX ───────────────────────────────────────────────────────────────────
/**
 * Escape what TeX treats as syntax.
 *
 * Order is the whole difficulty. A backslash must become `\textbackslash{}`, but
 * that replacement itself contains braces — so doing it first means the brace
 * rule below re-escapes them into `\textbackslash\{\}`. Backslashes are therefore
 * parked on a sentinel that contains no TeX-special characters, and restored
 * last. A fixture covers it; the first version of this function got it wrong.
 */
const TEX_BACKSLASH_SENTINEL = "\u0000TEXBS\u0000";

export function texEscape(s: string): string {
  return String(s ?? "")
    .replace(/\\/g, TEX_BACKSLASH_SENTINEL)
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}")
    .split(TEX_BACKSLASH_SENTINEL).join("\\textbackslash{}");
}

/**
 * Citation key: first author's surname + year + accession. The accession is
 * included because surname+year collides constantly in a review-sized set, and a
 * duplicate key makes BibTeX drop a reference silently.
 */
export function bibtexKey(rec: ExportRecord): string {
  const surname = (rec.authors?.[0] ?? "").split(/[\s,]+/)[0].replace(/[^A-Za-z]/g, "") || "anon";
  const year = (rec.year ?? "").replace(/[^0-9]/g, "") || "nd";
  const id = String(rec.pmid ?? "").replace(/[^A-Za-z0-9]/g, "");
  return `${surname.toLowerCase()}${year}${id ? "-" + id : ""}`;
}

function bibtexEntry(rec: ExportRecord, source?: Source): string {
  const type = risType(rec, source) === "RPRT" ? "techreport" : "article";
  const fields: Array<[string, string]> = [];
  // Double braces keep the title's capitalisation; BibTeX lowercases otherwise.
  if (rec.title) fields.push(["title", `{${texEscape(rec.title)}}`]);
  if (rec.authors?.length) fields.push(["author", texEscape(rec.authors.join(" and "))]);
  if (rec.journal) fields.push([type === "techreport" ? "institution" : "journal", texEscape(rec.journal)]);
  if (rec.year) fields.push(["year", texEscape(rec.year)]);
  if (rec.doi) fields.push(["doi", texEscape(rec.doi)]);
  if (rec.pmid) fields.push(["note", texEscape(`Accession ${rec.pmid}`)]);
  if (rec.url) fields.push(["url", texEscape(rec.url)]);
  const body = fields.map(([k, v]) => `  ${k} = {${v}}`).join(",\n");
  return `@${type}{${bibtexKey(rec)},\n${body}\n}`;
}

export function toBibtex(records: ExportRecord[], source?: Source): string {
  if (!records.length) return "";
  return records.map(r => bibtexEntry(r, source)).join("\n\n") + "\n";
}

// ── CSV ──────────────────────────────────────────────────────────────────────
export const CSV_COLUMNS = ["id", "type", "title", "authors", "journal", "year", "doi", "keywords", "url"] as const;

/** RFC 4180: quote when the value holds a comma, quote or newline; double quotes. */
export function csvCell(value: string): string {
  const v = String(value ?? "");
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(records: ExportRecord[], source?: Source): string {
  const rows = [CSV_COLUMNS.join(",")];
  for (const r of records) {
    rows.push([
      r.pmid ?? "",
      risType(r, source),
      r.title ?? "",
      (r.authors ?? []).join("; "),
      r.journal ?? "",
      r.year ?? "",
      r.doi ?? "",
      [...(r.keywords ?? []), ...(r.mesh ?? []), ...(r.eric ?? [])].join("; "),
      r.url ?? "",
    ].map(csvCell).join(","));
  }
  // Trailing newline: some parsers drop the last row without it.
  return rows.join(CRLF) + CRLF;
}

// ── Deduplication ────────────────────────────────────────────────────────────
export interface DedupeResult {
  records: ExportRecord[];
  removed: number;
  /** Ids dropped as duplicates, so the count can be audited rather than trusted. */
  removedIds: string[];
  note: string;
}

/**
 * Dedupe WITHIN one export set: by DOI first (the only cross-database identity we
 * can trust), then by accession.
 *
 * This is not cross-database deduplication. A PubMed record and its
 * ClinicalTrials.gov registration for the same study share no identifier, and
 * ReviewSeed exports one database at a time — so that merge happens in the
 * screening tool, and the note says so instead of implying it's done.
 */
export function dedupeRecords(records: ExportRecord[]): DedupeResult {
  const seenDoi = new Set<string>();
  const seenId = new Set<string>();
  const out: ExportRecord[] = [];
  const removedIds: string[] = [];
  for (const r of records) {
    const doi = (r.doi ?? "").trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
    const id = String(r.pmid ?? "").trim();
    if (doi && seenDoi.has(doi)) { removedIds.push(id); continue; }
    if (id && seenId.has(id)) { removedIds.push(id); continue; }
    if (doi) seenDoi.add(doi);
    if (id) seenId.add(id);
    out.push(r);
  }
  return {
    records: out,
    removed: removedIds.length,
    removedIds,
    note: "Deduplicated within this export only, by DOI then accession. Records duplicated ACROSS databases " +
          "(a paper and its trial registration, say) share no identifier and are not detected here — do that merge " +
          "in your screening tool.",
  };
}

// ── PRISMA flow starting numbers ─────────────────────────────────────────────
export interface PrismaCounts {
  identified: Array<{ source: string; query: string; at: string; total: number }>;
  identifiedTotal: number | null;
  exported: number;
  duplicatesRemoved: number;
  notRecorded: string[];
}

/**
 * The numbers a PRISMA flow diagram starts with, and — as important — the ones
 * ReviewSeed cannot know. Screening and eligibility decisions happen in another
 * tool, so claiming a complete flow diagram here would be a fabrication.
 */
export function prismaCounts(
  searchLog: Array<{ at: string; source: string; query: string; total: number }>,
  exported: number,
  duplicatesRemoved: number,
): PrismaCounts {
  // One entry per database: the most recent search for each, since earlier ones
  // were superseded rather than additional.
  const latest = new Map<string, { source: string; query: string; at: string; total: number }>();
  for (const e of searchLog) latest.set(e.source, { source: e.source, query: e.query, at: e.at, total: e.total });
  const identified = [...latest.values()];
  return {
    identified,
    identifiedTotal: identified.length ? identified.reduce((n, e) => n + e.total, 0) : null,
    exported,
    duplicatesRemoved,
    notRecorded: [
      "Records screened, excluded, and the reasons — those decisions happen in your screening tool.",
      "Reports sought for retrieval, and those not retrieved.",
      "Studies included in the review, and in any synthesis.",
      "Records found by hand-searching, citation-chasing, or from other registers.",
    ],
  };
}
