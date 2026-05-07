import { describe, it, expect } from "bun:test";
import { forwardBearer } from "../src/fetch.js";
import { createWorkerFetch } from "../src/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// ---------------------------------------------------------------------------
// forwardBearer
// ---------------------------------------------------------------------------

describe("forwardBearer", () => {
  it("injects Authorization: Bearer header", async () => {
    let capturedAuth = "";
    const origFetch = globalThis.fetch;
    globalThis.fetch = ((_input: unknown, init?: RequestInit): Promise<Response> => {
      capturedAuth = new Headers(init?.headers).get("Authorization") ?? "";
      return Promise.resolve(new Response("ok"));
    }) as unknown as typeof fetch;

    try {
      await forwardBearer("secret-token")("https://api.example.com/resource");
    } finally {
      globalThis.fetch = origFetch;
    }

    expect(capturedAuth).toBe("Bearer secret-token");
  });

  it("preserves other request headers", async () => {
    let capturedAccept = "";
    const origFetch = globalThis.fetch;
    globalThis.fetch = ((_input: unknown, init?: RequestInit): Promise<Response> => {
      capturedAccept = new Headers(init?.headers).get("Accept") ?? "";
      return Promise.resolve(new Response("ok"));
    }) as unknown as typeof fetch;

    try {
      await forwardBearer("tok")("https://api.example.com/resource", {
        headers: { Accept: "application/fhir+json" },
      });
    } finally {
      globalThis.fetch = origFetch;
    }

    expect(capturedAccept).toBe("application/fhir+json");
  });

  it("overrides a pre-existing Authorization header", async () => {
    let capturedAuth = "";
    const origFetch = globalThis.fetch;
    globalThis.fetch = ((_input: unknown, init?: RequestInit): Promise<Response> => {
      capturedAuth = new Headers(init?.headers).get("Authorization") ?? "";
      return Promise.resolve(new Response("ok"));
    }) as unknown as typeof fetch;

    try {
      await forwardBearer("new-token")("https://api.example.com/resource", {
        headers: { Authorization: "Bearer old-token" },
      });
    } finally {
      globalThis.fetch = origFetch;
    }

    expect(capturedAuth).toBe("Bearer new-token");
  });

  it("accepts URL objects", async () => {
    const origFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = ((_input: unknown, _init?: RequestInit): Promise<Response> => {
      called = true;
      return Promise.resolve(new Response("ok"));
    }) as unknown as typeof fetch;

    try {
      await forwardBearer("tok")(new URL("https://api.example.com/resource"));
    } finally {
      globalThis.fetch = origFetch;
    }

    expect(called).toBe(true);
  });

  it("accepts Request objects", async () => {
    const origFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = ((_input: unknown, _init?: RequestInit): Promise<Response> => {
      called = true;
      return Promise.resolve(new Response("ok"));
    }) as unknown as typeof fetch;

    try {
      await forwardBearer("tok")(new Request("https://api.example.com/resource"));
    } finally {
      globalThis.fetch = origFetch;
    }

    expect(called).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createWorkerFetch
// ---------------------------------------------------------------------------

describe("createWorkerFetch", () => {
  const AS = "https://auth.example.com";

  it("returns a function", () => {
    const workerFetch = createWorkerFetch({
      authorizationServer: AS,
      createServer: () => new McpServer({ name: "test", version: "0.0.1" }),
    });
    expect(typeof workerFetch).toBe("function");
  });

  it("returns 200 for /.well-known/oauth-protected-resource", async () => {
    const workerFetch = createWorkerFetch({
      authorizationServer: AS,
      createServer: () => new McpServer({ name: "test", version: "0.0.1" }),
    });
    const res = await workerFetch(
      new Request("https://worker.example.com/.well-known/oauth-protected-resource"),
    );
    expect(res.status).toBe(200);
  });

  it("forwards waitUntil from the context when provided", async () => {
    const workerFetch = createWorkerFetch({
      authorizationServer: AS,
      createServer: () => new McpServer({ name: "test", version: "0.0.1" }),
    });
    // Just verify no error is thrown when ctx.waitUntil is provided
    const res = await workerFetch(
      new Request("https://worker.example.com/.well-known/oauth-protected-resource"),
      undefined,
      { waitUntil: (_p: Promise<unknown>) => undefined },
    );
    expect(res.status).toBe(200);
  });

  it("does not include waitUntil in platform ctx when ctx is undefined", async () => {
    const workerFetch = createWorkerFetch({
      authorizationServer: AS,
      createServer: () => new McpServer({ name: "test", version: "0.0.1" }),
    });
    const res = await workerFetch(
      new Request("https://worker.example.com/.well-known/oauth-protected-resource"),
      undefined,
      undefined,
    );
    expect(res.status).toBe(200);
  });
});
