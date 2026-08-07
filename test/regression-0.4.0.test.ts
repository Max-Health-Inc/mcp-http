import { describe, it, expect } from "bun:test";
import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/server";
import { mcpHono } from "../hono/index.js";
import { createMcpHttpHandler } from "../src/index.js";
import { handleMcpPost } from "../src/transport.js";

/** Contracts 0.4.0 changed that line coverage does not pin. */

function makeServer(): McpServer {
  const server = new McpServer({ name: "regression", version: "0.0.1" });
  server.registerTool("ping", { description: "ping" }, () =>
    Promise.resolve({ content: [{ type: "text" as const, text: "pong" }] }),
  );
  return server;
}

const META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
};

function modernCall(id: number): unknown {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: "ping", arguments: {}, _meta: META },
  };
}

function mcpHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2026-07-28",
    "Mcp-Method": "tools/call",
    "Mcp-Name": "ping",
  };
}

// ---------------------------------------------------------------------------
// mcpHono: the Hono Context must reach createServer
// ---------------------------------------------------------------------------

describe("mcpHono — platform context", () => {
  it("passes the Hono Context and env to createServer", async () => {
    const seen: Array<{ hasC: boolean; env: unknown; hasRequest: boolean }> = [];

    const app = new Hono<{ Bindings: { FHIR_URL: string } }>();
    app.route(
      "/",
      mcpHono<{ Bindings: { FHIR_URL: string } }>({
        createServer: (_token, ctx) => {
          seen.push({
            hasC: typeof ctx.c.req.url === "string",
            env: ctx.env,
            hasRequest: ctx.request instanceof Request,
          });
          return makeServer();
        },
      }),
    );

    const res = await app.fetch(
      new Request("https://api.example.com/mcp", {
        method: "POST",
        headers: mcpHeaders(),
        body: JSON.stringify(modernCall(1)),
      }),
      { FHIR_URL: "https://fhir.example.com" },
    );
    await res.text();

    expect(seen).toHaveLength(1);
    expect(seen[0]?.hasC).toBe(true);
    expect(seen[0]?.hasRequest).toBe(true);
    expect((seen[0]?.env as { FHIR_URL: string }).FHIR_URL).toBe(
      "https://fhir.example.com",
    );
  });

  it("keeps per-request context isolated across concurrent requests", async () => {
    // The handler is shared now, so context must ride the call, not the closure.
    const seen: Array<{ token: string | null; env: string }> = [];

    const app = new Hono<{ Bindings: { TENANT: string } }>();
    app.route(
      "/",
      mcpHono<{ Bindings: { TENANT: string } }>({
        createServer: async (token, ctx) => {
          // Yield so the requests overlap.
          await new Promise((r) => setTimeout(r, 10));
          seen.push({ token, env: (ctx.env as { TENANT: string }).TENANT });
          return makeServer();
        },
      }),
    );

    const call = async (tenant: string, token: string): Promise<Response> =>
      app.fetch(
        new Request("https://api.example.com/mcp", {
          method: "POST",
          headers: { ...mcpHeaders(), Authorization: `Bearer ${token}` },
          body: JSON.stringify(modernCall(1)),
        }),
        { TENANT: tenant },
      );

    const [a, b] = await Promise.all([call("alpha", "tok-a"), call("beta", "tok-b")]);
    await a.text();
    await b.text();

    expect(seen).toHaveLength(2);
    const alpha = seen.find((s) => s.env === "alpha");
    const beta = seen.find((s) => s.env === "beta");
    expect(alpha).toBeDefined();
    expect(beta).toBeDefined();
    expect(alpha?.env).toBe("alpha");
    expect(beta?.env).toBe("beta");
  });

  it("reuses one handler across requests rather than rebuilding per request", async () => {
    // A rebuilt handler would re-fetch discovery every request.
    let discoveryHits = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((url: string | URL | Request) => {
      const href = url instanceof Request ? url.url : url.toString();
      if (href.includes(".well-known/oauth-authorization-server")) {
        discoveryHits++;
        return Promise.resolve(
          new Response(JSON.stringify({ issuer: "https://auth.example.com" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return realFetch(url as RequestInfo);
    }) as typeof globalThis.fetch;

    try {
      const app = new Hono();
      app.route(
        "/",
        mcpHono({
          authorizationServer: "https://auth.example.com",
          discoverAuthorizationServer: true,
          createServer: () => makeServer(),
        }),
      );

      const probe = async (): Promise<Response> =>
        app.fetch(
          new Request("https://api.example.com/.well-known/oauth-authorization-server"),
        );

      await (await probe()).text();
      await (await probe()).text();
      await (await probe()).text();

      expect(discoveryHits).toBe(1);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// The wrapper's own layer must survive delegation
// ---------------------------------------------------------------------------

describe("createMcpHttpHandler — layer survives delegation", () => {
  it("applies CORS to the delegated MCP response", async () => {
    const handler = createMcpHttpHandler({
      createServer: () => makeServer(),
      cors: { origin: "https://app.example.com" },
    });

    const res = await handler(
      new Request("https://api.example.com/mcp", {
        method: "POST",
        headers: { ...mcpHeaders(), Origin: "https://app.example.com" },
        body: JSON.stringify(modernCall(4)),
      }),
    );

    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://app.example.com",
    );
    // Re-wrapped to attach headers; must still arrive intact.
    expect(await res.text()).toContain("pong");
  });

  it("reports the delegated request through onRequest", async () => {
    const events: Array<{ outcome: string; status: number }> = [];
    const handler = createMcpHttpHandler({
      createServer: () => makeServer(),
      onRequest: (e) => {
        events.push({ outcome: e.outcome, status: e.status });
      },
    });

    const res = await handler(
      new Request("https://api.example.com/mcp", {
        method: "POST",
        headers: mcpHeaders(),
        body: JSON.stringify(modernCall(5)),
      }),
    );
    await res.text();

    expect(events).toHaveLength(1);
    expect(events[0]?.outcome).toBe("ok");
    expect(events[0]?.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// transport: streaming responses must not be truncated by an early close
// ---------------------------------------------------------------------------

describe("handleMcpPost — streaming response lifecycle", () => {
  it("delivers the full body of a streamed response", async () => {
    const res = await handleMcpPost({
      createServer: makeServer,
      req: new Request("https://api.example.com/mcp", {
        method: "POST",
        headers: mcpHeaders(),
        body: JSON.stringify(modernCall(2)),
      }),
    });

    const text = await res.text();
    // A close fired before the stream drains would truncate this.
    expect(text).toContain("pong");
  });

  it("does not raise an unhandled rejection when the client disconnects", async () => {
    const seen: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      seen.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      const res = await handleMcpPost({
        createServer: makeServer,
        req: new Request("https://api.example.com/mcp", {
          method: "POST",
          headers: mcpHeaders(),
          body: JSON.stringify(modernCall(3)),
        }),
      });

      // Without an explicit catch this fires on every disconnected client.
      if (res.body !== null) await res.body.cancel();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(seen).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
