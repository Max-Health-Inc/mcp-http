import { describe, it, expect, mock, spyOn } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { handleMcpPost } from "../src/transport.js";

function makeServer(): McpServer {
  return new McpServer({ name: "test-transport", version: "0.0.1" });
}

const BASE = "https://api.example.com";

function makePostReq(body: unknown = {}): Request {
  return new Request(`${BASE}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// server.close() always called
// ---------------------------------------------------------------------------

describe("handleMcpPost — server.close() lifecycle", () => {
  it("calls server.close() on success", async () => {
    const server = makeServer();
    const closeSpy = spyOn(server, "close");

    const res = await handleMcpPost({
      server,
      req: makePostReq({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });

    // Consume body — for SSE responses, close is deferred until stream ends
    await res.text();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("calls server.close() even when transport throws", async () => {
    const server = makeServer();
    const closeSpy = spyOn(server, "close");

    // Simulate an unhandled error by passing a non-JSON body
    const badReq = new Request(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "NOT JSON",
    });

    // The transport may or may not throw — we just care close() was called
    const res = await handleMcpPost({ server, req: badReq }).catch(() => undefined);
    if (res) await res.text();

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// onError hook
// ---------------------------------------------------------------------------

describe("handleMcpPost — onError hook", () => {
  it("returns 500 JSON-RPC body by default on transport error", async () => {
    // Force an error by hacking the server's connect method
    const server = makeServer();
    spyOn(server, "connect").mockImplementation(() => {
      throw new Error("forced connect failure");
    });

    const res = await handleMcpPost({ server, req: makePostReq() });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { jsonrpc: string; error: { code: number } };
    expect(body.jsonrpc).toBe("2.0");
    expect(body.error.code).toBe(-32603);
  });

  it("calls onError hook with the thrown error", async () => {
    const server = makeServer();
    const err = new Error("forced failure");
    spyOn(server, "connect").mockImplementation(() => {
      throw err;
    });

    const onError = mock((_e: unknown) => undefined);
    await handleMcpPost({ server, req: makePostReq(), onError });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBe(err);
  });

  it("uses the Response returned by onError", async () => {
    const server = makeServer();
    spyOn(server, "connect").mockImplementation(() => {
      throw new Error("failure");
    });

    const customRes = new Response("custom", { status: 418 });
    const res = await handleMcpPost({
      server,
      req: makePostReq(),
      onError: () => customRes,
    });

    expect(res.status).toBe(418);
  });
});

// ---------------------------------------------------------------------------
// Accept header normalisation
// ---------------------------------------------------------------------------

describe("handleMcpPost — Accept normalisation", () => {
  it("returns a Response (not null/undefined)", async () => {
    const server = makeServer();
    const res = await handleMcpPost({
      server,
      req: new Request(`${BASE}/mcp`, {
        method: "POST",
        // Deliberately omit Accept — shim should add it
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      }),
    });
    expect(res).toBeInstanceOf(Response);
  });
});

// ---------------------------------------------------------------------------
// SSE stream lifecycle — server.close() must be deferred
// ---------------------------------------------------------------------------

describe("handleMcpPost — SSE stream lifecycle", () => {
  it("does not call server.close() before response body is consumed", async () => {
    const server = makeServer();
    // Register a tool so the initialize response returns something meaningful
    server.registerTool("ping", { description: "ping tool" }, () =>
      Promise.resolve({ content: [{ type: "text", text: "pong" }] }),
    );

    const closeSpy = spyOn(server, "close");

    const res = await handleMcpPost({
      server,
      req: new Request(`${BASE}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      }),
    });

    // If the response is SSE, server.close() must NOT have been called yet
    if (res.headers.get("Content-Type")?.includes("text/event-stream")) {
      expect(closeSpy).not.toHaveBeenCalled();
      // Consume the body — this triggers the deferred close
      await res.text();
      expect(closeSpy).toHaveBeenCalledTimes(1);
    } else {
      // JSON response — close is called immediately
      expect(closeSpy).toHaveBeenCalledTimes(1);
    }
  });

  it("calls server.close() when an SSE stream body is fully consumed", async () => {
    const server = makeServer();
    const closeSpy = spyOn(server, "close");

    const res = await handleMcpPost({
      server,
      req: new Request(`${BASE}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      }),
    });

    // Consume the full response
    await res.text();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("calls server.close() on error in the catch branch", async () => {
    const server = makeServer();
    spyOn(server, "connect").mockImplementation(() => {
      throw new Error("forced connect failure");
    });
    const closeSpy = spyOn(server, "close");

    await handleMcpPost({ server, req: makePostReq() });
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
