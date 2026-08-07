import { describe, it, expect } from "bun:test";
import { McpServer } from "@modelcontextprotocol/server";
import { handleMcpPost } from "../src/transport.js";

/**
 * The point of delegating to `createMcpHandler`: this package gets the
 * 2026-07-28 revision without owning any of it. These assert the behaviour that
 * the previous 2025-era transport could not produce, so they fail if the
 * delegation is ever unwound.
 */

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
    // `resultType` is required by this revision and absent from 2025-era replies.
    expect(body.result.resultType).toBe("complete");
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
    // No envelope, no modern headers — classified legacy and answered, not refused.
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
