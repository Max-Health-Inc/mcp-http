import { describe, it, expect, mock } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHttpHandler } from "../src/index.js";
import type { McpHttpHandlerConfig } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AS = "https://auth.example.com";
const BASE = "https://api.example.com";

function makeServer(): McpServer {
  return new McpServer({ name: "test", version: "0.0.1" });
}

function makeConfig(overrides: Partial<McpHttpHandlerConfig> = {}): McpHttpHandlerConfig {
  return {
    authorizationServer: AS,
    createServer: () => makeServer(),
    ...overrides,
  };
}

function validToken(): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const payload = btoa(JSON.stringify({ sub: "u1", exp }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `eyJ.${payload}.sig`;
}

function makeReq(
  path: string,
  method = "POST",
  token?: string,
  extra?: RequestInit,
): Request {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (method === "POST") headers["Content-Type"] = "application/json";
  return new Request(`${BASE}${path}`, { method, headers, ...extra });
}

// ---------------------------------------------------------------------------
// createMcpHttpHandler validation
// ---------------------------------------------------------------------------

describe("createMcpHttpHandler — config validation", () => {
  it("throws when authorizationServer is not a valid URL", () => {
    expect(() =>
      createMcpHttpHandler(makeConfig({ authorizationServer: "not-a-url" })),
    ).toThrow("[mcp-http]");
  });

  it("throws when mcpPath does not start with /", () => {
    expect(() => createMcpHttpHandler(makeConfig({ mcpPath: "mcp" }))).toThrow(
      "[mcp-http]",
    );
  });

  it("does not throw for a valid config", () => {
    expect(() => createMcpHttpHandler(makeConfig())).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Well-known routes
// ---------------------------------------------------------------------------

describe("GET /.well-known/oauth-protected-resource", () => {
  const handler = createMcpHttpHandler(makeConfig());

  it("returns 200", async () => {
    const res = await handler(makeReq("/.well-known/oauth-protected-resource", "GET"));
    expect(res.status).toBe(200);
  });

  it("returns application/json", async () => {
    const res = await handler(makeReq("/.well-known/oauth-protected-resource", "GET"));
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });

  it("body contains resource and authorization_servers", async () => {
    const res = await handler(makeReq("/.well-known/oauth-protected-resource", "GET"));
    const body = (await res.json()) as {
      resource: string;
      authorization_servers: string[];
    };
    expect(body.resource).toBe(BASE);
    expect(body.authorization_servers).toContain(AS);
  });

  it("responds without requiring a Bearer token", async () => {
    const res = await handler(makeReq("/.well-known/oauth-protected-resource", "GET"));
    expect(res.status).not.toBe(401);
  });

  it("attaches CORS headers", async () => {
    const res = await handler(makeReq("/.well-known/oauth-protected-resource", "GET"));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("GET /.well-known/oauth-authorization-server", () => {
  it("returns 404 when authorizationServerMetadata is not configured", async () => {
    const handler = createMcpHttpHandler(makeConfig());
    const res = await handler(makeReq("/.well-known/oauth-authorization-server", "GET"));
    expect(res.status).toBe(404);
  });

  it("returns 200 with the AS document when configured", async () => {
    const handler = createMcpHttpHandler(
      makeConfig({
        authorizationServerMetadata: {
          issuer: AS,
          token_endpoint: `${AS}/token`,
        },
      }),
    );
    const res = await handler(makeReq("/.well-known/oauth-authorization-server", "GET"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { issuer: string };
    expect(body.issuer).toBe(AS);
  });
});

// ---------------------------------------------------------------------------
// AS metadata auto-discovery
// ---------------------------------------------------------------------------

describe("GET /.well-known/oauth-authorization-server — discoverAuthorizationServer", () => {
  const AS_METADATA = { issuer: AS, token_endpoint: `${AS}/token` };

  it.serial("returns 200 with fetched metadata on successful discovery", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = ((_url: unknown) =>
      Promise.resolve(
        new Response(JSON.stringify(AS_METADATA)),
      )) as unknown as typeof fetch;
    try {
      const handler = createMcpHttpHandler(
        makeConfig({ discoverAuthorizationServer: true }),
      );
      const res = await handler(
        makeReq("/.well-known/oauth-authorization-server", "GET"),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { issuer: string };
      expect(body.issuer).toBe(AS);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it.serial(
    "fetches from {authorizationServer}/.well-known/oauth-authorization-server",
    async () => {
      let capturedUrl = "";
      const origFetch = globalThis.fetch;
      globalThis.fetch = ((url: unknown) => {
        capturedUrl = String(url);
        return Promise.resolve(new Response(JSON.stringify(AS_METADATA)));
      }) as unknown as typeof fetch;
      try {
        const handler = createMcpHttpHandler(
          makeConfig({ discoverAuthorizationServer: true }),
        );
        await handler(makeReq("/.well-known/oauth-authorization-server", "GET"));
        expect(capturedUrl).toBe(`${AS}/.well-known/oauth-authorization-server`);
      } finally {
        globalThis.fetch = origFetch;
      }
    },
  );

  it.serial(
    "caches the result — fetch is called only once across multiple requests",
    async () => {
      let callCount = 0;
      const origFetch = globalThis.fetch;
      globalThis.fetch = ((_url: unknown) => {
        callCount++;
        return Promise.resolve(new Response(JSON.stringify(AS_METADATA)));
      }) as unknown as typeof fetch;
      try {
        const handler = createMcpHttpHandler(
          makeConfig({ discoverAuthorizationServer: true }),
        );
        await handler(makeReq("/.well-known/oauth-authorization-server", "GET"));
        await handler(makeReq("/.well-known/oauth-authorization-server", "GET"));
        await handler(makeReq("/.well-known/oauth-authorization-server", "GET"));
        expect(callCount).toBe(1);
      } finally {
        globalThis.fetch = origFetch;
      }
    },
  );

  it.serial("returns 502 when discovery fetch fails with network error", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = ((_url: unknown) =>
      Promise.reject(new Error("network error"))) as unknown as typeof fetch;
    try {
      const handler = createMcpHttpHandler(
        makeConfig({ discoverAuthorizationServer: true }),
      );
      const res = await handler(
        makeReq("/.well-known/oauth-authorization-server", "GET"),
      );
      expect(res.status).toBe(502);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it.serial("returns 502 when AS returns a non-OK status", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = ((_url: unknown) =>
      Promise.resolve(new Response(null, { status: 404 }))) as unknown as typeof fetch;
    try {
      const handler = createMcpHttpHandler(
        makeConfig({ discoverAuthorizationServer: true }),
      );
      const res = await handler(
        makeReq("/.well-known/oauth-authorization-server", "GET"),
      );
      expect(res.status).toBe(502);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it.serial("retries discovery after a previous failure", async () => {
    let callCount = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = ((_url: unknown) => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error("transient error"));
      return Promise.resolve(new Response(JSON.stringify(AS_METADATA)));
    }) as unknown as typeof fetch;
    try {
      const handler = createMcpHttpHandler(
        makeConfig({ discoverAuthorizationServer: true }),
      );
      const res1 = await handler(
        makeReq("/.well-known/oauth-authorization-server", "GET"),
      );
      expect(res1.status).toBe(502);
      const res2 = await handler(
        makeReq("/.well-known/oauth-authorization-server", "GET"),
      );
      expect(res2.status).toBe(200);
      expect(callCount).toBe(2);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it.serial(
    "static authorizationServerMetadata takes precedence over discoverAuthorizationServer",
    async () => {
      let fetchCalled = false;
      const origFetch = globalThis.fetch;
      globalThis.fetch = ((_url: unknown) => {
        fetchCalled = true;
        return Promise.resolve(
          new Response(JSON.stringify({ issuer: "https://other.example.com" })),
        );
      }) as unknown as typeof fetch;
      try {
        const handler = createMcpHttpHandler(
          makeConfig({
            authorizationServerMetadata: { issuer: AS },
            discoverAuthorizationServer: true,
          }),
        );
        const res = await handler(
          makeReq("/.well-known/oauth-authorization-server", "GET"),
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as { issuer: string };
        expect(body.issuer).toBe(AS);
        expect(fetchCalled).toBe(false);
      } finally {
        globalThis.fetch = origFetch;
      }
    },
  );
});

// ---------------------------------------------------------------------------
// OPTIONS preflight
// ---------------------------------------------------------------------------

describe("OPTIONS preflight", () => {
  const handler = createMcpHttpHandler(makeConfig());

  it("returns 204", async () => {
    const res = await handler(makeReq("/mcp", "OPTIONS"));
    expect(res.status).toBe(204);
  });

  it("includes CORS headers", async () => {
    const res = await handler(makeReq("/mcp", "OPTIONS"));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  it("returns 204 for well-known preflight", async () => {
    const res = await handler(
      makeReq("/.well-known/oauth-protected-resource", "OPTIONS"),
    );
    expect(res.status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// Auth gate
// ---------------------------------------------------------------------------

describe("POST /mcp — auth gate", () => {
  const handler = createMcpHttpHandler(makeConfig());

  it("returns 401 when Authorization header is absent", async () => {
    const res = await handler(makeReq("/mcp", "POST"));
    expect(res.status).toBe(401);
  });

  it("returns 401 with WWW-Authenticate pointing to resource metadata", async () => {
    const res = await handler(makeReq("/mcp", "POST"));
    const wwwAuth = res.headers.get("WWW-Authenticate") ?? "";
    expect(wwwAuth).toContain("Bearer resource_metadata=");
    expect(wwwAuth).toContain("/.well-known/oauth-protected-resource");
  });

  it("returns 401 when token is expired", async () => {
    const expiredPayload = btoa(
      JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 120 }),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const expiredToken = `eyJ.${expiredPayload}.sig`;
    const res = await handler(makeReq("/mcp", "POST", expiredToken));
    expect(res.status).toBe(401);
  });

  it("does not reject opaque (non-JWT) tokens via exp check", async () => {
    // An opaque token has no base64-encoded JSON payload — isJwtExpired returns false
    // The handler should NOT 401 for opaque tokens (upstream validates them)
    // We can't test the upstream 200 here without a real MCP call, so just
    // verify it does NOT return 401 due to earlyReject
    const handler2 = createMcpHttpHandler(
      makeConfig({ earlyRejectExpiredTokens: false }),
    );
    // With earlyReject off the handler should proceed past the exp check
    // (it will fail later trying to parse MCP, but not with 401)
    const res = await handler2(
      new Request(`${BASE}/mcp`, {
        method: "POST",
        headers: {
          Authorization: "Bearer opaque-token-xyz",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      }),
    );
    expect(res.status).not.toBe(401);
  });

  it("attaches CORS headers even on 401", async () => {
    const res = await handler(makeReq("/mcp", "POST"));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

// ---------------------------------------------------------------------------
// Method not allowed
// ---------------------------------------------------------------------------

describe("Non-POST on /mcp", () => {
  const handler = createMcpHttpHandler(makeConfig());

  it("returns 405 for GET /mcp", async () => {
    const res = await handler(makeReq("/mcp", "GET", validToken()));
    expect(res.status).toBe(405);
  });

  it("returns 405 for DELETE /mcp", async () => {
    const res = await handler(makeReq("/mcp", "DELETE", validToken()));
    expect(res.status).toBe(405);
  });

  it("includes Allow header", async () => {
    const res = await handler(makeReq("/mcp", "GET", validToken()));
    expect(res.headers.get("Allow")).toContain("POST");
  });
});

// ---------------------------------------------------------------------------
// 404 for unknown routes
// ---------------------------------------------------------------------------

describe("Unknown routes", () => {
  const handler = createMcpHttpHandler(makeConfig());

  it("returns 404 for an unmapped path", async () => {
    const res = await handler(makeReq("/unknown", "GET"));
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// onRequest hook
// ---------------------------------------------------------------------------

describe("onRequest hook", () => {
  it("is called with the correct outcome for well-known", async () => {
    const events: string[] = [];
    const handler = createMcpHttpHandler(
      makeConfig({
        onRequest: (ev) => {
          events.push(ev.outcome);
        },
      }),
    );
    await handler(makeReq("/.well-known/oauth-protected-resource", "GET"));
    expect(events).toContain("well-known");
  });

  it("is called with 'unauthorized' for missing token", async () => {
    const events: string[] = [];
    const handler = createMcpHttpHandler(
      makeConfig({
        onRequest: (ev) => {
          events.push(ev.outcome);
        },
      }),
    );
    await handler(makeReq("/mcp", "POST"));
    expect(events).toContain("unauthorized");
  });

  it("swallows errors thrown by the hook", async () => {
    const handler = createMcpHttpHandler(
      makeConfig({
        onRequest: () => {
          throw new Error("hook error");
        },
      }),
    );
    // Should not throw
    const res = await handler(makeReq("/.well-known/oauth-protected-resource", "GET"));
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// CORS disabled
// ---------------------------------------------------------------------------

describe("cors: false", () => {
  const handler = createMcpHttpHandler(makeConfig({ cors: false }));

  it("does not set ACAO header", async () => {
    const res = await handler(makeReq("/.well-known/oauth-protected-resource", "GET"));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("OPTIONS still routed (no preflight response — caller handles)", async () => {
    const res = await handler(makeReq("/mcp", "OPTIONS"));
    // With cors:false, handlePreflight returns null, so the request falls
    // through to normal routing → /mcp OPTIONS → 405
    expect(res.status).toBe(405);
  });
});

// ---------------------------------------------------------------------------
// createServer error handling
// ---------------------------------------------------------------------------

describe("createServer error propagation", () => {
  it("returns 500 JSON-RPC error when createServer throws", async () => {
    const handler = createMcpHttpHandler(
      makeConfig({
        createServer: () => {
          throw new Error("init failed");
        },
      }),
    );
    const res = await handler(makeReq("/mcp", "POST", validToken()));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32603);
  });

  it("calls onError hook when createServer throws", async () => {
    const onError = mock(() => undefined);
    const handler = createMcpHttpHandler(
      makeConfig({
        createServer: () => {
          throw new Error("init failed");
        },
        onError,
      }),
    );
    await handler(makeReq("/mcp", "POST", validToken()));
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("uses the Response returned by onError", async () => {
    const customRes = new Response("custom error", { status: 503 });
    const handler = createMcpHttpHandler(
      makeConfig({
        createServer: () => {
          throw new Error("init failed");
        },
        onError: () => customRes,
      }),
    );
    const res = await handler(makeReq("/mcp", "POST", validToken()));
    expect(res.status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// TDD: Bug — authorizationServer trailing slash normalization
// ---------------------------------------------------------------------------

describe("authorizationServer trailing slash normalization", () => {
  it("strips trailing slash from authorization_servers in PR metadata", async () => {
    const handler = createMcpHttpHandler(makeConfig({ authorizationServer: `${AS}/` }));
    const res = await handler(makeReq("/.well-known/oauth-protected-resource", "GET"));
    const body = (await res.json()) as { authorization_servers: string[] };
    // Trailing slash on authorizationServer must be stripped so downstream
    // clients can match it against the AS's issuer claim (RFC 8414 §2 forbids
    // trailing slashes on issuer identifiers).
    expect(body.authorization_servers[0]).toBe(AS);
  });

  it.serial("strips trailing slash before building the AS discovery URL", async () => {
    let capturedUrl = "";
    const origFetch = globalThis.fetch;
    globalThis.fetch = ((url: unknown) => {
      capturedUrl = String(url);
      return Promise.resolve(new Response(JSON.stringify({ issuer: AS })));
    }) as unknown as typeof fetch;
    try {
      const handler = createMcpHttpHandler(
        makeConfig({ authorizationServer: `${AS}/`, discoverAuthorizationServer: true }),
      );
      await handler(makeReq("/.well-known/oauth-authorization-server", "GET"));
      // Must NOT produce a double slash like "https://auth.example.com//.well-known/..."
      expect(capturedUrl).toBe(`${AS}/.well-known/oauth-authorization-server`);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// TDD: Bug — cors:false OPTIONS Allow header
// ---------------------------------------------------------------------------

describe("cors: false — OPTIONS Allow header", () => {
  it("does not list OPTIONS in Allow header when cors is disabled", async () => {
    const handler = createMcpHttpHandler(makeConfig({ cors: false }));
    const res = await handler(makeReq("/mcp", "OPTIONS"));
    expect(res.status).toBe(405);
    // When cors is disabled the handler does not handle OPTIONS, so it must
    // not advertise OPTIONS as an allowed method in the Allow header.
    expect(res.headers.get("Allow")).not.toContain("OPTIONS");
  });
});

// ---------------------------------------------------------------------------
// TDD: Bug — onRequest outcome for unmatched routes
// ---------------------------------------------------------------------------

describe("onRequest outcome for unmatched routes", () => {
  it("reports 'not-found' outcome (not 'error') for a 404", async () => {
    const events: Array<{ outcome: string; status: number }> = [];
    const handler = createMcpHttpHandler(
      makeConfig({
        onRequest: (ev) => {
          events.push({ outcome: ev.outcome, status: ev.status });
        },
      }),
    );
    await handler(makeReq("/no-such-path", "GET"));
    expect(events[0]?.status).toBe(404);
    // "error" outcome must be reserved for actual server errors (5xx), not 404s.
    expect(events[0]?.outcome).toBe("not-found");
  });
});
