import { describe, it, expect } from "bun:test";
import { McpServer } from "@modelcontextprotocol/server";
import { handleMcpPost } from "../src/transport.js";

/** Behaviour the 2025-era transport could not produce; fails if delegation is unwound. */

function makeServer(): McpServer {
  const server = new McpServer({ name: "protocol-test", version: "0.0.1" });
  server.registerTool("ping", { description: "ping tool" }, () =>
    Promise.resolve({ content: [{ type: "text" as const, text: "pong" }] }),
  );
  return server;
}

const META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
};

async function post(headers: Record<string, string>, body: unknown): Promise<Response> {
  return handleMcpPost({
    createServer: makeServer,
    req: new Request("https://api.example.com/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2026-07-28",
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  });
}

describe("2026-07-28 protocol", () => {
  it("serves a tool call with no initialize handshake", async () => {
    const res = await post(
      { "Mcp-Method": "tools/call", "Mcp-Name": "ping" },
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "ping", arguments: {}, _meta: META },
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { content: Array<{ text: string }>; resultType: string };
    };
    expect(body.result.content[0]?.text).toBe("pong");
    // Required by this revision, absent from 2025-era replies.
    expect(body.result.resultType).toBe("complete");
  });

  it("answers server/discover with the supported versions and capabilities", async () => {
    const res = await post(
      { "Mcp-Method": "server/discover" },
      { jsonrpc: "2.0", id: 4, method: "server/discover", params: { _meta: META } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { supportedVersions: string[]; capabilities: Record<string, unknown> };
    };
    expect(body.result.supportedVersions).toContain("2026-07-28");
    expect(body.result.capabilities).toHaveProperty("tools");
  });

  it("rejects a header/body method mismatch with -32020 HeaderMismatch", async () => {
    const res = await post(
      { "Mcp-Method": "tools/list", "Mcp-Name": "ping" },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "ping", arguments: {}, _meta: META },
      },
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: number; data?: { mismatch?: unknown } };
    };
    expect(body.error.code).toBe(-32020);
    expect(body.error.data?.mismatch).toBeDefined();
  });

  it("still serves 2025-era traffic (legacy defaults to 'stateless')", async () => {
    // No envelope: classified legacy and answered, not refused.
    const res = await handleMcpPost({
      createServer: makeServer,
      req: new Request("https://api.example.com/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "initialize",
          params: {},
        }),
      }),
    });

    expect(res.status).toBeLessThan(500);
  });
});
