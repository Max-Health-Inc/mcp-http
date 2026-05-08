import { describe, it, expect } from "bun:test";
import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpHono } from "../hono/index.js";
import { forwardBearer } from "../src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AS = "https://auth.example.com";
const BASE = "https://api.example.com";

const nowSec = (): number => Math.floor(Date.now() / 1000);

function validJwt(): string {
  const payload = btoa(JSON.stringify({ sub: "u1", exp: nowSec() + 3600 }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `eyJ.${payload}.sig`;
}

function makeServer(): McpServer {
  return new McpServer({ name: "integration-test", version: "0.0.1" });
}

// ---------------------------------------------------------------------------
// Integration: full request → response through the Hono adapter
// ---------------------------------------------------------------------------

describe("mcpHono integration", () => {
  const app = new Hono();
  app.route(
    "/",
    mcpHono({
      authorizationServer: AS,
      createServer: (_token) => makeServer(),
    }),
  );

  const honoFetch = app.fetch.bind(app);

  // ---- Well-known ----------------------------------------------------------

  it("serves /.well-known/oauth-protected-resource without auth", async () => {
    const res = await honoFetch(
      new Request(`${BASE}/.well-known/oauth-protected-resource`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { resource: string };
    expect(body.resource).toBe(`${BASE}/mcp`);
  });

  it("does NOT serve /.well-known/oauth-authorization-server (not configured)", async () => {
    const res = await honoFetch(
      new Request(`${BASE}/.well-known/oauth-authorization-server`),
    );
    expect(res.status).toBe(404);
  });

  // ---- Auth gate -----------------------------------------------------------

  it("returns 401 without Authorization header", async () => {
    const res = await honoFetch(new Request(`${BASE}/mcp`, { method: "POST" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain("Bearer resource_metadata=");
  });

  it("returns 401 with CORS headers so browser clients can read the error", async () => {
    const res = await honoFetch(
      new Request(`${BASE}/mcp`, {
        method: "POST",
        headers: { Origin: "https://app.example.com" },
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  // ---- MCP POST flow -------------------------------------------------------

  it("processes an MCP initialize request", async () => {
    const token = validJwt();
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test-client", version: "0.0.1" },
      },
    };
    const res = await honoFetch(
      new Request(`${BASE}/mcp`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify(body),
      }),
    );
    expect(res.status).toBe(200);
    // Mark token as captured for downstream assertions (unused in simplified test)
  });

  // ---- CORS ----------------------------------------------------------------

  it("handles OPTIONS preflight", async () => {
    const res = await honoFetch(
      new Request(`${BASE}/mcp`, {
        method: "OPTIONS",
        headers: {
          Origin: "https://app.example.com",
          "Access-Control-Request-Method": "POST",
        },
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  // ---- forwardBearer -------------------------------------------------------

  it("forwardBearer injects Authorization on outgoing requests", async () => {
    const token = "my-test-token";
    const fetchFn = forwardBearer(token);

    let capturedAuth = "";
    const mockFetch = (
      _input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      capturedAuth = new Headers(init?.headers).get("Authorization") ?? "";
      return Promise.resolve(new Response("ok"));
    };

    // Call via the wrapper but swap global fetch temporarily
    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    try {
      await fetchFn("https://fhir.example.com/Patient", {
        headers: { Accept: "application/fhir+json" },
      });
    } finally {
      globalThis.fetch = origFetch;
    }

    expect(capturedAuth).toBe(`Bearer ${token}`);
  });
});
