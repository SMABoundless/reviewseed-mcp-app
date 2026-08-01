// Reproducibility receipt + re-run diff (docs/REPORTS-ROADMAP.md §3.13).
//
// SHARED LOGIC. The website has a behavioral twin (index.html's page-globals
// buildReceipt / diffReceipts / receiptFingerprint) and both run
// tests/fixtures/receipt-parity.json.
//
// PURE: no network, no clock — `searchedAt` and totals are inputs.
//
// WHAT A RECEIPT IS: enough of a search strategy to re-run it later and know
// whether you re-ran the SAME thing. That's the whole design constraint, and it
// decides what goes in and what stays out:
//
//   IN  — source, the query as sent, limits, vocabulary editions, tool version.
//         Change any of these and you are running a different search.
//   OUT — `generatedAt` (changes on every render), result counts and ids (they
//         change upstream, which is the point of diffing), and the term pool's
//         internal bookkeeping (selections that don't reach the string).
//
// The word "fingerprint" is deliberate. This detects CHANGE, not tampering: it's
// a fast non-cryptographic digest, not a signature, and nothing here stops
// someone editing a receipt. Calling it a hash would imply a guarantee it
// doesn't make.
import type { SearchProtocol } from "./protocol.js";
import type { Source } from "./types.js";

export interface Receipt {
  schema: "reviewseed.receipt/1";
  /** Change-detection digest over the reproducible fields below. */
  fingerprint: string;
  source: Source;
  sourceLabel: string;
  platform: string;
  /** The query as sent, flattened to one line. */
  query: string;
  mode: "boolean" | "framework";
  framework: string | null;
  limits: string[];
  vocabularies: Array<{ key: string; edition: string | null }>;
  tool: { name: string; version: string; surface: string };
  /** When the search ran, and what it returned — the part expected to change. */
  searchedAt: string | null;
  total: number | null;
  /** Record ids observed at that time. A sample, not the whole result set. */
  sampledIds: string[];
  sampleNote: string;
}

/**
 * Canonical text the fingerprint is computed over. Key order is fixed here rather
 * than left to JSON.stringify's insertion order, so two repos building the same
 * receipt from the same protocol agree.
 */
export function receiptBasis(r: Pick<Receipt, "source" | "query" | "mode" | "framework" | "limits" | "vocabularies">): string {
  return JSON.stringify([
    r.source,
    r.query,
    r.mode,
    r.framework ?? "",
    [...r.limits],                                       // order as applied
    r.vocabularies.map(v => [v.key, v.edition ?? ""]),
  ]);
}

/**
 * FNV-1a, 32-bit, rendered as 8 hex chars. Chosen over SHA-256 because this is a
 * change detector: it must be synchronous (the browser's crypto.subtle is async,
 * which would make every consumer async for no benefit), stable across both
 * runtimes, and short enough for a human to compare by eye in a methods section.
 */
export function receiptFingerprint(basis: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < basis.length; i++) {
    h ^= basis.charCodeAt(i);
    // >>> 0 keeps this in unsigned 32-bit space; Math.imul avoids the precision
    // loss a plain multiply would hit.
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export interface ReceiptRun {
  searchedAt?: string | null;
  total?: number | null;
  sampledIds?: string[];
}

export function buildReceipt(p: SearchProtocol, run: ReceiptRun = {}): Receipt {
  // Prefer the log entry for THIS source: it records the query as actually sent,
  // which is what a re-run has to reproduce.
  const forSource = p.searchLog.filter(e => e.source === p.source.key);
  const last = forSource.length ? forSource[forSource.length - 1] : null;

  const core = {
    source: p.source.key,
    query: (p.query.string || "").replace(/\n/g, " ").trim(),
    mode: p.query.mode,
    framework: p.query.mode === "framework" && p.query.framework ? p.query.framework.key : null,
    limits: [...p.filters.summary],
    vocabularies: p.vocabularies.map(v => ({ key: v.key, edition: v.edition })),
  };

  const sampledIds = [...(run.sampledIds ?? [])];
  return {
    schema: "reviewseed.receipt/1",
    fingerprint: receiptFingerprint(receiptBasis(core)),
    ...core,
    sourceLabel: p.source.label,
    platform: p.source.platform,
    tool: { name: p.tool.name, version: p.tool.version, surface: p.tool.surface },
    searchedAt: run.searchedAt ?? last?.at ?? null,
    total: run.total ?? last?.total ?? null,
    sampledIds,
    sampleNote: sampledIds.length
      ? `${sampledIds.length} ids sampled from the top of the result set — not the full set, so a record can appear or vanish from the sample without entering or leaving the results.`
      : "No ids recorded, so only the total can be compared.",
  };
}

export interface ReceiptDiff {
  /** False when the two receipts describe different searches. */
  comparable: boolean;
  /** Why they can't be compared, when they can't. */
  incomparableReason: string | null;
  /** Which reproducible fields differ, when the fingerprints don't match. */
  changed: string[];
  totalBefore: number | null;
  totalAfter: number | null;
  totalDelta: number | null;
  /** Ids present now and not then, within the sampled sets. */
  newIds: string[];
  /** Ids present then and not now, within the sampled sets. */
  goneIds: string[];
  elapsed: { from: string | null; to: string | null };
  interpretation: string;
}

const FIELD_LABELS: Record<string, string> = {
  source: "database",
  query: "query string",
  mode: "builder mode",
  framework: "framework",
  limits: "limits applied",
  vocabularies: "vocabulary editions",
};

/**
 * Compare a stored receipt against a fresh one.
 *
 * The load-bearing behavior: if the fingerprints differ, this REFUSES to present
 * a count delta as drift in the literature. Two different searches returning
 * different numbers is not a finding, and reporting it as "N new records since
 * July" would be actively misleading — the most plausible-looking wrong answer
 * this whole feature could produce.
 */
export function diffReceipts(before: Receipt, after: Receipt): ReceiptDiff {
  const changed: string[] = [];
  for (const key of ["source", "query", "mode", "framework", "limits", "vocabularies"] as const) {
    if (JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null)) changed.push(key);
  }
  const comparable = before.fingerprint === after.fingerprint;

  const totalBefore = before.total ?? null;
  const totalAfter = after.total ?? null;
  const totalDelta = totalBefore !== null && totalAfter !== null ? totalAfter - totalBefore : null;

  const beforeIds = new Set(before.sampledIds);
  const afterIds = new Set(after.sampledIds);
  const newIds = comparable ? after.sampledIds.filter(id => !beforeIds.has(id)) : [];
  const goneIds = comparable ? before.sampledIds.filter(id => !afterIds.has(id)) : [];

  let interpretation: string;
  let incomparableReason: string | null = null;
  if (!comparable) {
    const which = changed.map(k => FIELD_LABELS[k] ?? k).join(", ");
    incomparableReason = `The strategy changed (${which}), so these two receipts describe different searches.`;
    interpretation = `${incomparableReason} A difference in totals here says nothing about the literature — it's a difference between two questions. Re-run the ORIGINAL strategy to measure change over time.`;
  } else if (totalDelta === null) {
    interpretation = "The strategy is unchanged, but one of the receipts has no recorded total, so there is nothing to compare yet.";
  } else if (totalDelta === 0) {
    interpretation = "Same strategy, same total. Nothing new has been indexed that this search retrieves — note that identical totals can still hide a swap (one record added, one withdrawn).";
  } else if (totalDelta > 0) {
    interpretation = `Same strategy, ${totalDelta} more record${totalDelta === 1 ? "" : "s"} than when the receipt was made. That's the number to screen for a review update.`;
  } else {
    interpretation = `Same strategy, ${Math.abs(totalDelta)} fewer record${totalDelta === -1 ? "" : "s"}. Records do leave: retractions, de-duplication, and re-indexing all reduce a count without anything being wrong.`;
  }

  return {
    comparable,
    incomparableReason,
    changed,
    totalBefore,
    totalAfter,
    totalDelta,
    newIds,
    goneIds,
    elapsed: { from: before.searchedAt ?? null, to: after.searchedAt ?? null },
    interpretation,
  };
}
