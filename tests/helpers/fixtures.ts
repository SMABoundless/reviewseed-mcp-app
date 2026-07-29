import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool, KwFields } from "../../server/query.js";
import type { ProtocolInput, SearchProtocol } from "../../server/protocol.js";
import type { Source } from "../../server/types.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(HERE, "..", "fixtures");
export const FIXTURES_PATH = path.join(FIXTURES_DIR, "query-parity.json");
export const PROTOCOL_FIXTURES_PATH = path.join(FIXTURES_DIR, "protocol-parity.json");

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

export interface ProtocolCase {
  name: string;
  input: ProtocolInput;
  expected: SearchProtocol;
}
export interface ProtocolFixtures {
  version: number;
  cases: ProtocolCase[];
}

export function loadProtocolFixtures(): ProtocolFixtures {
  return JSON.parse(fs.readFileSync(PROTOCOL_FIXTURES_PATH, "utf-8")) as ProtocolFixtures;
}
