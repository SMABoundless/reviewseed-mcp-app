// Boots a real MCP client+server pair in-process over InMemoryTransport.
//
// In-process (rather than spawning `dist/main.js --stdio`) buys three things:
// the suite runs against server.ts source with no build step, `globalThis.fetch`
// stubs installed by the test actually apply to the server's adapters, and
// there's no child process to leak.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../../server.js";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIST_HTML = path.join(REPO_ROOT, "dist", "mcp-app.html");

// server.ts reads dist/mcp-app.html when the UI resource is requested. Tests
// assert on that resource's _meta (CSP/permissions), not its markup, so stand
// in a placeholder when the repo hasn't been built — and remove it afterwards
// so a later real build isn't shadowed by test residue.
function ensureDistHtml(): () => void {
  if (fs.existsSync(DIST_HTML)) return () => {};
  fs.mkdirSync(path.dirname(DIST_HTML), { recursive: true });
  fs.writeFileSync(DIST_HTML, "<!doctype html><title>placeholder</title>");
  return () => { try { fs.rmSync(DIST_HTML); } catch { /* already gone */ } };
}

export interface Harness {
  client: Client;
  close(): Promise<void>;
}

export async function startHarness(): Promise<Harness> {
  const cleanupHtml = ensureDistHtml();
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "reviewseed-tests", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
      cleanupHtml();
    },
  };
}

/** Tool results are JSON-in-a-text-block; unwrap to the parsed payload. */
export function payload<T = any>(result: unknown): T {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  const text = content.find(c => c.type === "text")?.text;
  if (text === undefined) throw new Error("tool result had no text content");
  return JSON.parse(text) as T;
}
