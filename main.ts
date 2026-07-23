import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response } from "express";
import { createServer } from "./server.js";
import { ericLookup, ericSearch } from "./server/eric.js";
import { ericThesaurusSearch } from "./server/eric-thesaurus.js";
import { meshVocabSearch } from "./server/mesh.js";
import { pubmedLookup, pubmedSearch } from "./server/pubmed.js";
import { ctLookup, ctSearch } from "./server/trials.js";
import type { Source } from "./server/types.js";

// Manually set CORS headers — cors() middleware doesn't apply through createMcpExpressApp
function setCors(res: Response): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
}

function parseSource(req: Request, res: Response): Source | null {
  const source = String(req.query.source ?? "pubmed");
  if (source !== "pubmed" && source !== "eric" && source !== "trials") {
    res.status(400).json({ error: 'source must be "pubmed", "eric", or "trials"' });
    return null;
  }
  return source;
}

async function startStreamableHTTPServer(): Promise<void> {
  const port = parseInt(process.env.PORT ?? "3001", 10);
  const app  = createMcpExpressApp({ host: "0.0.0.0" });

  // ── Preflight for REST routes ─────────────────────────────────────────────────
  app.options("/api/*path", (req: Request, res: Response) => {
    setCors(res);
    res.sendStatus(204);
  });

  // ── REST fallback — callable from a Claude artifact when the host can't
  //    render the MCP App UI inline ────────────────────────────────────────────
  app.get("/api/search", async (req: Request, res: Response) => {
    setCors(res);
    const source = parseSource(req, res);
    if (!source) return;
    const q    = String(req.query.q ?? "").trim();
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
    if (!q) { res.status(400).json({ error: "q is required" }); return; }
    try {
      const r = source === "eric" ? await ericSearch(q, page, 10)
        : source === "trials" ? await ctSearch(q, page)
        : await pubmedSearch(q, page, 10);
      res.json(r);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.get("/api/lookup", async (req: Request, res: Response) => {
    setCors(res);
    const source = parseSource(req, res);
    if (!source) return;
    const text = String(req.query.text ?? "").trim();
    if (!text) { res.status(400).json({ error: "text is required" }); return; }
    try {
      const r = source === "eric" ? await ericLookup(text)
        : source === "trials" ? await ctLookup(text)
        : await pubmedLookup(text);
      res.json(r);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.get("/api/vocab", async (req: Request, res: Response) => {
    setCors(res);
    const vocab = String(req.query.vocab ?? "mesh");
    if (vocab !== "mesh" && vocab !== "eric") { res.status(400).json({ error: 'vocab must be "mesh" or "eric"' }); return; }
    const q = String(req.query.q ?? "").trim();
    if (!q) { res.status(400).json({ error: "q is required" }); return; }
    try {
      const rows = vocab === "mesh" ? await meshVocabSearch(q) : await ericThesaurusSearch(q);
      res.json({ rows: rows ?? [] });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.all("/mcp", async (req: Request, res: Response) => {
    const server    = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  const httpServer = app.listen(port, () => {
    console.log(`ReviewSeed MCP App listening on http://localhost:${port}/mcp`);
  });

  const shutdown = () => {
    console.log("\nShutting down…");
    httpServer.close(() => process.exit(0));
  };
  process.on("SIGINT",  shutdown);
  process.on("SIGTERM", shutdown);
}

async function startStdioServer(): Promise<void> {
  await createServer().connect(new StdioServerTransport());
}

async function main() {
  if (process.argv.includes("--stdio")) {
    await startStdioServer();
  } else {
    await startStreamableHTTPServer();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
