import { describe, it, expect, afterEach } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { handleMcpPostStateful } from "../src/transport.js";
import { SessionStore } from "../src/session-store.js";

const BASE = "https://api.example.com";

function makeInitReq(): Request {
  return new Request(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: { sampling: {} },
        clientInfo: { name: "test-client", version: "0.1.0" },
      },
    }),
  });
}

function makeSessionReq(sessionId: string, body: unknown): Request {
  return new Request(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "mcp-session-id": sessionId,
    },
    body: JSON.stringify(body),
  });
}

describe("handleMcpPostStateful", () => {
  let store: SessionStore;

  afterEach(() => {
    store.destroy();
  });

  it("creates a session on initialize and returns session ID header", async () => {
    store = new SessionStore({ ttlMs: 60_000 });

    const res = await handleMcpPostStateful({
      createServer: () => new McpServer({ name: "stateful-test", version: "0.0.1" }),
      req: makeInitReq(),
      sessionStore: store,
    });

    expect(res.status).toBe(200);
    const sessionId = res.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();
    // Session should be stored
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(store.has(sessionId!)).toBe(true);

    // Consume body
    await res.text();
  });

  it("routes subsequent requests to existing session", async () => {
    store = new SessionStore({ ttlMs: 60_000 });

    // Initialize
    const initRes = await handleMcpPostStateful({
      createServer: () => new McpServer({ name: "stateful-test", version: "0.0.1" }),
      req: makeInitReq(),
      sessionStore: store,
    });
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const sessionId = initRes.headers.get("mcp-session-id")!;
    await initRes.text();

    // Send notifications/initialized via the session
    const notifRes = await handleMcpPostStateful({
      createServer: () =>
        new McpServer({ name: "should-not-be-called", version: "0.0.1" }),
      req: makeSessionReq(sessionId, {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
      sessionStore: store,
    });

    // Notifications return 202 Accepted (no response body)
    expect(notifRes.status).toBe(202);
  });

  it("returns 404 for unknown session ID", async () => {
    store = new SessionStore({ ttlMs: 60_000 });

    const res = await handleMcpPostStateful({
      createServer: () => new McpServer({ name: "test", version: "0.0.1" }),
      req: makeSessionReq("bogus-session-id", {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
      sessionStore: store,
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect((body as { error: string }).error).toBe("Session not found");
  });

  it("handles createServer errors gracefully", async () => {
    store = new SessionStore({ ttlMs: 60_000 });

    const res = await handleMcpPostStateful({
      createServer: () => {
        throw new Error("factory failed");
      },
      req: makeInitReq(),
      sessionStore: store,
    });

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32603);
  });
});
