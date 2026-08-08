// LibKey.io article links (Third Iron).
//
// SHARED LOGIC. The website has a behavioral twin (index.html's page-global
// libkeyUrl) and both run tests/fixtures/libkey-parity.json.
//
// PURE: builds a URL, fetches nothing. No API key, no subscription, no script —
// it is a plain link, so nothing is loaded and nobody is tracked until a user
// clicks it. That is the reason to prefer this over any embeddable widget.
//
// WHY THE UNIVERSAL FORM, NOT THE LIBRARY-SPECIFIC ONE
//
// Third Iron documents two article patterns:
//   https://libkey.io/{id}                      — universal
//   https://libkey.io/libraries/{libId}/{id}    — pins to ONE library
//
// The second "overrides existing affiliation with the specified library". On a
// site open to the world, hard-coding one institution's id would hand every
// visitor that library's holdings instead of their own — the opposite of what a
// LibKey link is for. The universal form lets LibKey use each reader's own
// affiliation, and falls back to open-access copies plus a DOI resolver for
// anyone unaffiliated.
//
// Verified 2026-08-08: the universal DOI form, the universal PMID form, and the
// library-specific form all resolve.
import type { Source } from "./types.js";

export const LIBKEY_BASE = "https://libkey.io";

export const LIBKEY_NOTE =
  "LibKey resolves to the reader's own institution, or to an open-access copy when they have no affiliation. " +
  "No library id is embedded, so every reader gets their own library's holdings rather than ours.";

/** Records as they arrive from any adapter; `src` is absent on this site's PubMed records. */
interface LinkableRecord {
  pmid?: string;
  doi?: string;
  src?: Source;
}

/**
 * A LibKey URL for a record, or null when LibKey has no identifier it can use.
 *
 * LibKey takes a DOI or a PMID and nothing else. That makes this PubMed-shaped
 * in practice:
 *   - PubMed records always carry a numeric PMID, which is what Third Iron's own
 *     PubMed integration keys on, so it is preferred when present.
 *   - ERIC accessions (EJ…/ED…) and ClinicalTrials.gov NCT ids are not LibKey
 *     identifiers. ERIC's API exposes no DOI field at all, so those records
 *     genuinely have nothing to link with — returning null is the honest answer,
 *     and callers must render nothing rather than a link that dead-ends.
 */
export function libkeyUrl(rec: LinkableRecord, source?: Source): string | null {
  const src = rec.src ?? source;
  const id = String(rec.pmid ?? "").trim();
  const doi = String(rec.doi ?? "").trim();

  // A bare run of digits is a PMID. `pmid` doubles as the generic record key
  // across all three sources, so the shape is what distinguishes it from an
  // ERIC accession or an NCT id — never trust the field name alone.
  const looksLikePmid = /^\d{1,9}$/.test(id);
  if (looksLikePmid && src !== "eric" && src !== "trials") {
    return `${LIBKEY_BASE}/${id}`;
  }
  if (doi) {
    // Accept a DOI however it arrives; LibKey wants the bare form.
    const bare = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:/i, "").trim();
    if (bare) return `${LIBKEY_BASE}/${bare}`;
  }
  return null;
}
