// Independent ~2.85 req/sec limiter per upstream API (NCBI's unauthenticated
// cap is 3/sec; ERIC and ClinicalTrials.gov have undocumented but similarly
// tight limits). Each source gets its own clock so one busy source can't
// starve another — mirrors the pattern proven out on the ReviewSeed website.
export function createLimiter(minGapMs = 350) {
  let lastFireAt = 0;
  return async function limit(): Promise<void> {
    const now = Date.now();
    const fireAt = Math.max(now, lastFireAt + minGapMs);
    lastFireAt = fireAt;
    const wait = fireAt - now;
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
  };
}
