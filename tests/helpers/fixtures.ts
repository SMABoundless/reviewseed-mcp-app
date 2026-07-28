import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool, KwFields } from "../../server/query.js";
import type { Source } from "../../server/types.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES_PATH = path.join(HERE, "..", "fixtures", "query-parity.json");

export interface BooleanCase {
  name: string;
  target: Source;
  pool: Pool;
  kwFields: KwFields;
  opts: { kwOp?: "OR" | "AND"; vocabOp?: "OR" | "AND"; joinOp?: "AND" | "OR" };
  expected: string;
}
export interface FrameworkCase {
  name: string;
  target: Source;
  frameworkKey: string;
  buckets: Record<string, string[]>;
  pool: Pool;
  kwFields: KwFields;
  expected: string;
}
export interface ParityFixtures {
  version: number;
  boolean: BooleanCase[];
  framework: FrameworkCase[];
}

export function loadParityFixtures(): ParityFixtures {
  return JSON.parse(fs.readFileSync(FIXTURES_PATH, "utf-8")) as ParityFixtures;
}
