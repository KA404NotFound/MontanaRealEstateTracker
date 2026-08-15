import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { registerTools } from "./tools.js";

const PORT = process.env.PORT || 3100;

// Required — fails closed rather than being reachable with no auth at all (same pattern
// as backend's INGEST_TOKEN). This exposes a live SQL-backed query surface over the
// network; even though the underlying data is public record, a shared secret is a
// cheap, sensible default rather than trusting network placement alone. See Phase 8 in
// the plan doc for the local-vs-remote decision this followed.
const MCP_TOKEN = process.env.MCP_TOKEN;
if (!MCP_TOKEN) {
  console.error("MCP_TOKEN is not set — refusing to start. Set MCP_TOKEN in the environment.");
  process.exit(1);
}

function getServer() {
  const server = new McpServer({ name: "montana-real-estate-tracker", version: "1.0.0" });
  registerTools(server);
  return server;
}

const app = createMcpExpressApp({ host: "0.0.0.0" });

// Unauthenticated on purpose (registered before the auth middleware below) — Docker's
// healthcheck runs inside the container and shouldn't need the token, same as backend's
// /api/health.
app.get("/health", (req, res) => res.json({ status: "ok" }));

app.use((req, res, next) => {
  const auth = req.get("authorization") || "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (provided !== MCP_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
});

// Stateless mode — a fresh McpServer + transport per request, no session persisted
// between calls. Fine for a tool-calling server with no server-initiated notifications;
// avoids the added complexity/failure modes of tracking session state across requests.
// Follows the SDK's own simpleStatelessStreamableHttp.js reference example closely.
app.post("/mcp", async (req, res) => {
  const server = getServer();
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => {
      transport.close();
      server.close();
    });
  } catch (err) {
    console.error("Error handling MCP request:", err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});

// Stateless mode doesn't support server-initiated streams (GET) or explicit session
// teardown (DELETE) — matches the SDK's own reference stateless example.
app.get("/mcp", (req, res) => {
  res.writeHead(405).end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }));
});
app.delete("/mcp", (req, res) => {
  res.writeHead(405).end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }));
});

app.listen(PORT, () => {
  console.log(`MCP server listening on port ${PORT}`);
});
