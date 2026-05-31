import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { SessionStore } from "../src/session-store.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

function makeServer(): McpServer {
  return new McpServer({ name: "test-session", version: "0.0.1" });
}

function makeEntry(server?: McpServer) {
  return {
    transport: new WebStandardStreamableHTTPServerTransport(),
    server: server ?? makeServer(),
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
  };
}

describe("SessionStore", () => {
  let store: SessionStore;

  beforeEach(() => {
    store = new SessionStore({ ttlMs: 1000, sweepIntervalMs: 100_000 });
  });

  afterEach(() => {
    store.destroy();
  });

  it("stores and retrieves a session", () => {
    const entry = makeEntry();
    store.set("abc", entry);
    expect(store.get("abc")).toBe(entry);
  });

  it("returns undefined for unknown session", () => {
    expect(store.get("unknown")).toBeUndefined();
  });

  it("has() returns true for existing sessions", () => {
    store.set("x", makeEntry());
    expect(store.has("x")).toBe(true);
    expect(store.has("y")).toBe(false);
  });

  it("tracks size correctly", () => {
    expect(store.size).toBe(0);
    store.set("a", makeEntry());
    store.set("b", makeEntry());
    expect(store.size).toBe(2);
  });

  it("close() removes a session", () => {
    store.set("a", makeEntry());
    store.close("a");
    expect(store.has("a")).toBe(false);
    expect(store.size).toBe(0);
  });

  it("close() is a no-op for unknown sessions", () => {
    store.close("nope"); // should not throw
    expect(store.size).toBe(0);
  });

  it("expires sessions after TTL", async () => {
    store.destroy();
    store = new SessionStore({ ttlMs: 50, sweepIntervalMs: 100_000 });
    store.set("short", makeEntry());
    expect(store.has("short")).toBe(true);

    await new Promise((r) => setTimeout(r, 60));
    expect(store.get("short")).toBeUndefined();
  });

  it("sweep() removes expired sessions", async () => {
    store.destroy();
    store = new SessionStore({ ttlMs: 30, sweepIntervalMs: 100_000 });
    store.set("a", makeEntry());
    store.set("b", makeEntry());

    await new Promise((r) => setTimeout(r, 40));
    store.sweep();
    expect(store.size).toBe(0);
  });

  it("get() updates lastAccessedAt to keep session alive", async () => {
    store.destroy();
    store = new SessionStore({ ttlMs: 80, sweepIntervalMs: 100_000 });
    store.set("alive", makeEntry());

    // Access it at 40ms — should reset the TTL clock
    await new Promise((r) => setTimeout(r, 40));
    expect(store.get("alive")).toBeDefined();

    // At 90ms total (50ms since last access), still alive
    await new Promise((r) => setTimeout(r, 50));
    expect(store.get("alive")).toBeDefined();
  });

  it("destroy() cleans up everything", () => {
    store.set("a", makeEntry());
    store.set("b", makeEntry());
    store.destroy();
    expect(store.size).toBe(0);
  });
});
