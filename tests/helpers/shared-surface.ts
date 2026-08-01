import path from "node:path";
import { fileURLToPath } from "node:url";
import { PUBMED_FIELDS } from "../../server/pubmed.js";
import { ERIC_ADV_FIELDS } from "../../server/eric.js";
import { CT_ADV_FIELDS } from "../../server/trials.js";
import { FRAMEWORKS } from "../../server/query.js";
import { SLOW_LOOKUP_MS, SLOW_LOOKUP_NOTICE } from "../../server/mesh.js";
import { PLATFORMS, PLATFORM_CAVEAT } from "../../server/translate.js";
import { LINT_RULES, PRESS_DOMAINS } from "../../server/lint.js";
import { HEDGES, HEDGE_CAVEAT } from "../../server/hedges.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SHARED_SURFACE_PATH = path.join(HERE, "..", "fixtures", "shared-surface.json");

/**
 * The shared CONFIGURATION both ReviewSeed codebases must agree on: the three
 * advanced-search field lists, the framework definitions, and the slow-lookup
 * threshold/copy (one wording for "NLM is slow", not two). Order matters —
 * both apps render these lists directly, so a reordering is a real UI diff.
 *
 * `blurb` is intentionally excluded: it's prose shown only in the MCP app's
 * framework picker and is free to differ.
 */
export function buildSharedSurface() {
  return {
    pubmedFields: PUBMED_FIELDS,
    ericAdvFields: ERIC_ADV_FIELDS,
    ctAdvFields: CT_ADV_FIELDS,
    frameworks: Object.fromEntries(Object.entries(FRAMEWORKS).map(([key, f]) => [key, {
      label: f.label,
      full: f.full,
      tag: f.tag,
      buckets: f.buckets.map(b => ({ key: b.key, label: b.label })),
    }])),
    slowLookup: { ms: SLOW_LOOKUP_MS, notice: SLOW_LOOKUP_NOTICE },
    // The emit-only translation roster. Data, not behavior: if one repo gains a
    // platform (or edits a vendor note) and the other doesn't, this fails
    // immediately instead of the two quietly offering different menus.
    // The hedge catalogue. Data, and the most consequential kind: these strings go
    // into real search strategies, so one repo carrying a different transcription
    // than the other must fail loudly rather than silently changing someone's recall.
    hedges: { caveat: HEDGE_CAVEAT, list: HEDGES },
    // The lint rule catalogue. Data, not behavior: neither repo may add a rule or
    // reclassify a severity without the other going red — a check that fires in
    // one app and not the other would make the audit unrepeatable.
    lint: {
      domains: PRESS_DOMAINS,
      rules: LINT_RULES,
    },
    translation: {
      caveat: PLATFORM_CAVEAT,
      platforms: PLATFORMS.map(p => ({ key: p.key, label: p.label, vendor: p.vendor, vocabulary: p.vocabulary, note: p.note })),
    },
  };
}
