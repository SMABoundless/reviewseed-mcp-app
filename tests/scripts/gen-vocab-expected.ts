// Regenerates tests/fixtures/vocab-expected.json by running the canonical NLM
// payloads (vocab-inputs.json) through THIS repo's MeSH vocabulary fetchers.
//
//   npm run snapshot
//
// Generated rather than hand-written for the same reason as parser-expected.json:
// a hand-maintained VocabRow[] would be a third copy that can rot without either
// implementation changing. The website asserts its own fetchers produce these
// same objects from the same bytes — any divergence is drift.
import fs from "node:fs";
import { buildVocabExpected, VOCAB_EXPECTED_PATH } from "../helpers/vocab-fixtures.js";

fs.writeFileSync(VOCAB_EXPECTED_PATH, JSON.stringify(await buildVocabExpected(), null, 2) + "\n");
console.log(`wrote ${VOCAB_EXPECTED_PATH}`);
