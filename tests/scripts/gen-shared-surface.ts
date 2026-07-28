// Regenerates tests/fixtures/shared-surface.json from this repo's live values.
//
//   npm run snapshot
//
// The snapshot is CONFIGURATION, not behavior, so it's compared directly rather
// than via input→expected fixtures: both repos assert they equal this file, so
// adding a field to one side and not the other fails immediately with nothing
// to hand-maintain. tests/unit/shared-surface.test.ts fails if this file is
// stale relative to the code, which is the prompt to re-run this script.
import fs from "node:fs";
import { buildSharedSurface, SHARED_SURFACE_PATH } from "../helpers/shared-surface.js";

fs.writeFileSync(SHARED_SURFACE_PATH, JSON.stringify(buildSharedSurface(), null, 2) + "\n");
console.log(`wrote ${SHARED_SURFACE_PATH}`);
