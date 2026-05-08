import { describe, it, expect } from "bun:test";
import { applyCors, handlePreflight } from "../src/cors.js";

const makeReq = (origin?: string): Request =>
  new Request("https://api.example.com/mcp", {
    method: "POST",
    headers: origin ? { Origin: origin } : {},
  });

// ---------------------------------------------------------------------------
// applyCors
// ---------------------------------------------------------------------------

describe("applyCors — origin: '*' (default)", () => {
  it("sets ACAO to *", () => {
    const headers = new Headers();
    applyCors(headers, makeReq("https://app.example.com"), {});
    expect(headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("does not set ACAC header by default", () => {
    const headers = new Headers();
    applyCors(headers, makeReq(), {});
    expect(headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("throws when credentials: true is combined with wildcard origin (implicit)", () => {
    const headers = new Headers();
    expect(() => {
      applyCors(headers, makeReq(), { credentials: true });
    }).toThrow("[mcp-http]");
  });

  it("throws when credentials: true is combined with origin: '*'", () => {
    const headers = new Headers();
    expect(() => {
      applyCors(headers, makeReq(), { credentials: true, origin: "*" });
    }).toThrow("[mcp-http]");
  });

  it("includes all MCP-required allow headers", () => {
    const headers = new Headers();
    applyCors(headers, makeReq(), {});
    const allowed = headers.get("Access-Control-Allow-Headers") ?? "";
    expect(allowed).toContain("Content-Type");
    expect(allowed).toContain("Authorization");
    expect(allowed).toContain("Mcp-Session-Id");
    expect(allowed).toContain("Last-Event-ID");
  });

  it("merges extra allowHeaders", () => {
    const headers = new Headers();
    applyCors(headers, makeReq(), { allowHeaders: ["X-Custom"] });
    const allowed = headers.get("Access-Control-Allow-Headers") ?? "";
    expect(allowed).toContain("X-Custom");
    expect(allowed).toContain("Authorization");
  });

  it("exposes Mcp-Session-Id by default", () => {
    const headers = new Headers();
    applyCors(headers, makeReq(), {});
    const exposed = headers.get("Access-Control-Expose-Headers") ?? "";
    expect(exposed).toContain("Mcp-Session-Id");
  });

  it("merges extra exposeHeaders", () => {
    const headers = new Headers();
    applyCors(headers, makeReq(), { exposeHeaders: ["X-Rate-Limit"] });
    const exposed = headers.get("Access-Control-Expose-Headers") ?? "";
    expect(exposed).toContain("X-Rate-Limit");
    expect(exposed).toContain("Mcp-Session-Id");
  });
});

describe("applyCors — credentials with explicit origin", () => {
  it("sets ACAC when credentials: true and origin is an explicit string", () => {
    const headers = new Headers();
    applyCors(headers, makeReq("https://app.example.com"), {
      credentials: true,
      origin: "https://app.example.com",
    });
    expect(headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });

  it("sets ACAC when credentials: true and origin is a string[]", () => {
    const headers = new Headers();
    applyCors(headers, makeReq("https://app.example.com"), {
      credentials: true,
      origin: ["https://app.example.com"],
    });
    expect(headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });
});

describe("applyCors — origin: specific string", () => {
  it("echoes the configured origin (not *)", () => {
    const headers = new Headers();
    applyCors(headers, makeReq("https://app.example.com"), {
      origin: "https://app.example.com",
    });
    expect(headers.get("Access-Control-Allow-Origin")).toBe("https://app.example.com");
  });

  it("sets Vary: Origin when a specific string origin is used", () => {
    const headers = new Headers();
    applyCors(headers, makeReq("https://app.example.com"), {
      origin: "https://app.example.com",
    });
    const vary = headers.get("Vary") ?? "";
    expect(vary).toContain("Origin");
  });
});

describe("applyCors — origin: string[]", () => {
  const allowedOrigins = ["https://a.example.com", "https://b.example.com"];

  it("echoes a matched origin", () => {
    const headers = new Headers();
    applyCors(headers, makeReq("https://a.example.com"), { origin: allowedOrigins });
    expect(headers.get("Access-Control-Allow-Origin")).toBe("https://a.example.com");
  });

  it("does not set ACAO for an unrecognised origin", () => {
    const headers = new Headers();
    applyCors(headers, makeReq("https://evil.com"), { origin: allowedOrigins });
    expect(headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("does not set ACAO when no Origin header is present", () => {
    const headers = new Headers();
    applyCors(headers, makeReq(), { origin: allowedOrigins });
    expect(headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("applyCors — origin: function", () => {
  it("uses the return value of the function", () => {
    const headers = new Headers();
    applyCors(headers, makeReq("https://dynamic.example.com"), {
      origin: () => "https://dynamic.example.com",
    });
    expect(headers.get("Access-Control-Allow-Origin")).toBe(
      "https://dynamic.example.com",
    );
  });

  it("omits ACAO when function returns null", () => {
    const headers = new Headers();
    applyCors(headers, makeReq("https://blocked.example.com"), {
      origin: () => null,
    });
    expect(headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// handlePreflight
// ---------------------------------------------------------------------------

describe("handlePreflight", () => {
  const optionsReq = new Request("https://api.example.com/mcp", { method: "OPTIONS" });

  it("returns 204 for OPTIONS with default CORS config", () => {
    const res = handlePreflight(optionsReq, {});
    expect(res?.status).toBe(204);
  });

  it("sets Access-Control-Allow-Methods", () => {
    const res = handlePreflight(optionsReq, {});
    const methods = res?.headers.get("Access-Control-Allow-Methods") ?? "";
    expect(methods).toContain("POST");
    expect(methods).toContain("OPTIONS");
  });

  it("sets Access-Control-Max-Age to 600 by default", () => {
    const res = handlePreflight(optionsReq, {});
    expect(res?.headers.get("Access-Control-Max-Age")).toBe("600");
  });

  it("uses custom maxAge when provided", () => {
    const res = handlePreflight(optionsReq, { maxAge: 3600 });
    expect(res?.headers.get("Access-Control-Max-Age")).toBe("3600");
  });

  it("returns null when cors is false", () => {
    expect(handlePreflight(optionsReq, false)).toBeNull();
  });
});
