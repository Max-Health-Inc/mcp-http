import { describe, it, expect, mock } from "bun:test";
import { McpServer } from "@modelcontextprotocol/server";
import { handleMcpPost } from "../src/transport.js";

function makeServer(): McpServer {
  const server = new McpServer({ name: "test-transport", version: "0.0.1" });
  server.registerTool("ping", { description: "ping tool" }, () =>
    Promise.resolve({ content: [{ type: "text" as const, text: "pong" }] }),
  );
  return server;
}

const BASE = "https://api.example.com";

function makePostReq(body: unknown = {}): Request {
  return new Request(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
}

const INITIALIZE = { jsonrpc: "2.0", id: 1, method: "initialize", params: {} };

// ---------------------------------------------------------------------------
// Delegation contract
// ---------------------------------------------------------------------------

describe("handleMcpPost — delegation", () => {
  it("answers a POST with a Response", async () => {
    const res = await handleMcpPost({
      createServer: makeServer,
      req: makePostReq(INITIALIZE),
    });
    expect(res).toBeInstanceOf(Response);
  });

  it("invokes the factory to build the server", async () => {
    const createServer = mock(() => makeServer());
    const res = await handleMcpPost({ createServer, req: makePostReq(INITIALIZE) });
    await res.text();
    expect(createServer).toHaveBeenCalled();
  });

  it("streams an SSE body through to completion", async () => {
    const res = await handleMcpPost({
      createServer: makeServer,
      req: makePostReq(INITIALIZE),
    });
    // Whether the SDK answers JSON or SSE, the body must be readable in full:
    // closing the handler before the stream drains would truncate it.
    const text = await res.text();
    expect(typeof text).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// onError — the contract createMcpHandler cannot express itself
// ---------------------------------------------------------------------------

describe("handleMcpPost — onError hook", () => {
  it("returns a 500 JSON-RPC body by default when the factory throws", async () => {
    const res = await handleMcpPost({
      createServer: () => {
        throw new Error("factory failed");
      },
      req: makePostReq(INITIALIZE),
    });

    expect(res.status).toBe(500);
    const body = (await res.json()) as { jsonrpc: string; error: { code: number } };
    expect(body.jsonrpc).toBe("2.0");
    expect(body.error.code).toBe(-32603);
  });

  it("calls onError with the thrown error", async () => {
    const err = new Error("factory failed");
    const onError = mock((_e: unknown) => undefined);

    await handleMcpPost({
      createServer: () => {
        throw err;
      },
      req: makePostReq(INITIALIZE),
      onError,
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBe(err);
  });

  it("uses the Response returned by onError", async () => {
    const res = await handleMcpPost({
      createServer: () => {
        throw new Error("failure");
      },
      req: makePostReq(INITIALIZE),
      onError: () => new Response("custom", { status: 418 }),
    });

    expect(res.status).toBe(418);
  });

  it("falls back to the 500 body when onError returns undefined", async () => {
    const res = await handleMcpPost({
      createServer: () => {
        throw new Error("failure");
      },
      req: makePostReq(INITIALIZE),
      onError: () => undefined,
    });

    expect(res.status).toBe(500);
  });

  it("falls back to the 500 body when onError itself throws", async () => {
    const res = await handleMcpPost({
      createServer: () => {
        throw new Error("failure");
      },
      req: makePostReq(INITIALIZE),
      onError: () => {
        throw new Error("hook exploded");
      },
    });

    expect(res.status).toBe(500);
  });
});
