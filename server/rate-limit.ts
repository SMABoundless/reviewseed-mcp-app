// Independent ~2.85 req/sec limiter per upstream API (NCBI's unauthenticated
// cap is 3/sec; ERIC and ClinicalTrials.gov have undocumented but similarly
// tight limits). Each source gets its own clock so one busy source can't
// starve another — mirrors the pattern proven out on the ReviewSeed website.

// Tests override this to ~0 so a mocked-fetch suite doesn't spend real seconds
// pacing requests that never leave the process. Guarded with `typeof process`
// because this module IS reachable from the browser bundle (mcp-app.tsx →
// query.ts → eric.ts/trials.ts → here), where `process` is undefined.
const envGap = typeof process !== "undefined" ? Number(process.env?.REVIEWSEED_RATE_LIMIT_MS) : NaN;
// The override beats any per-source pacing too (see pubmed.ts's keyed rate),
// so a mocked suite stays instant whatever the environment holds.
export function paceMs(fallback: number): number {
  return Number.isFinite(envGap) && envGap >= 0 ? envGap : fallback;
}
const DEFAULT_GAP_MS = paceMs(350);

export function createLimiter(minGapMs = DEFAULT_GAP_MS) {
  let lastFireAt = 0;
  return async function limit(): Promise<void> {
    const now = Date.now();
    const fireAt = Math.max(now, lastFireAt + minGapMs);
    lastFireAt = fireAt;
    const wait = fireAt - now;
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
  };
}
