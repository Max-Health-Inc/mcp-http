import { describe, it, expect } from "bun:test";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHttpHandler, isOriginAllowed } from "../src/index.js";

function makeServer(): McpServer {
  const server = new McpServer({ name: "origin", version: "0.0.1" });
  server.registerTool("ping", { description: "ping" }, () =>
    Promise.resolve({ content: [{ type: "text" as const, text: "pong" }] }),
  );
  return server;
}

const META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
};

function post(origin?: string): Request {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2026-07-28",
    "Mcp-Method": "tools/call",
    "Mcp-Name": "ping",
  };
  if (origin !== undefined) headers["Origin"] = origin;
  return new Request("https://api.example.com/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "ping", arguments: {}, _meta: META },
    }),
  });
}

const req = (origin?: string): Request => post(origin);

describe("isOriginAllowed", () => {
  it("allows an absent Origin (non-browser caller)", () => {
    expect(isOriginAllowed(req(), { origin: ["https://app.example.com"] })).toBe(true);
  });

  it("allows anything under the wildcard default", () => {
    expect(isOriginAllowed(req("https://evil.example"), {})).toBe(true);
    expect(isOriginAllowed(req("https://evil.example"), { origin: "*" })).toBe(true);
  });

  it("matches a string config exactly", () => {
    const opts = { origin: "https://app.example.com" };
    expect(isOriginAllowed(req("https://app.example.com"), opts)).toBe(true);
    expect(isOriginAllowed(req("https://evil.example"), opts)).toBe(false);
  });

  it("matches membership for an array config", () => {
    const opts = { origin: ["https://a.example", "https://b.example"] };
    expect(isOriginAllowed(req("https://b.example"), opts)).toBe(true);
    expect(isOriginAllowed(req("https://c.example"), opts)).toBe(false);
  });

  it("honours a function config, including its null", () => {
    expect(isOriginAllowed(req("https://a.example"), { origin: () => null })).toBe(false);
    expect(
      isOriginAllowed(req("https://a.example"), {
        origin: (r) => r.headers.get("Origin"),
      }),
    ).toBe(true);
  });
});

describe("MCP endpoint — Origin gate", () => {
  it("refuses a disallowed Origin with 403 before the tool runs", async () => {
    let built = 0;
    const handler = createMcpHttpHandler({
      createServer: () => {
        built++;
        return makeServer();
      },
      cors: { origin: ["https://app.example.com"] },
    });

    const res = await handler(req("https://evil.example"));

    expect(res.status).toBe(403);
    // The point of the rule: the request must not have executed.
    expect(built).toBe(0);
    const body = (await res.json()) as { jsonrpc: string; id: null };
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBeNull();
  });

  it("serves a permitted Origin", async () => {
    const handler = createMcpHttpHandler({
      createServer: () => makeServer(),
      cors: { origin: ["https://app.example.com"] },
    });

    const res = await handler(req("https://app.example.com"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("pong");
  });

  it("serves a request with no Origin at all", async () => {
    const handler = createMcpHttpHandler({
      createServer: () => makeServer(),
      cors: { origin: ["https://app.example.com"] },
    });

    const res = await handler(req());
    expect(res.status).toBe(200);
  });

  it("does not gate under the wildcard default", async () => {
    const handler = createMcpHttpHandler({ createServer: () => makeServer() });
    const res = await handler(req("https://anywhere.example"));
    expect(res.status).toBe(200);
  });

  it("reports the refusal through onRequest", async () => {
    const outcomes: string[] = [];
    const handler = createMcpHttpHandler({
      createServer: () => makeServer(),
      cors: { origin: ["https://app.example.com"] },
      onRequest: (e) => {
        outcomes.push(e.outcome);
      },
    });

    await handler(req("https://evil.example"));
    expect(outcomes).toEqual(["forbidden"]);
  });
});

describe("401 challenge — delegated to the SDK", () => {
  it("names the error and carries an OAuth error body", async () => {
    const handler = createMcpHttpHandler({
      authorizationServer: "https://auth.example.com",
      createServer: () => makeServer(),
    });

    const res = await handler(req());

    expect(res.status).toBe(401);
    const wwwAuth = res.headers.get("WWW-Authenticate") ?? "";
    // RFC 6750 wants the error code in the challenge; the hand-rolled version omitted it.
    expect(wwwAuth).toContain('error="invalid_token"');
    expect(wwwAuth).toContain("resource_metadata=");
    expect((await res.json()) as unknown).toMatchObject({ error: "invalid_token" });
  });
});
