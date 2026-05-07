import { describe, it, expect } from "bun:test";
import {
  buildProtectedResourceMetadata,
  buildAuthorizationServerMetadata,
  protectedResourceResponse,
  authorizationServerResponse,
  PROTECTED_RESOURCE_PATH,
  AUTHORIZATION_SERVER_PATH,
} from "../src/well-known.js";

const AS = "https://auth.example.com";
const REQUEST_URL = "https://api.example.com/mcp";
const ORIGIN = "https://api.example.com";

describe("buildProtectedResourceMetadata", () => {
  it("derives resource from request origin (not full URL)", () => {
    const doc = buildProtectedResourceMetadata(REQUEST_URL, AS);
    expect(doc.resource).toBe(ORIGIN);
  });

  it("sets authorization_servers to the configured AS", () => {
    const doc = buildProtectedResourceMetadata(REQUEST_URL, AS);
    expect(doc.authorization_servers).toEqual([AS]);
  });

  it("merges extra fields", () => {
    const doc = buildProtectedResourceMetadata(REQUEST_URL, AS, {
      bearer_methods_supported: ["header"],
      resource_name: "My API",
    });
    expect(doc.bearer_methods_supported).toEqual(["header"]);
    expect(doc.resource_name).toBe("My API");
  });

  it("does not allow extra fields to override resource or authorization_servers", () => {
    const doc = buildProtectedResourceMetadata(REQUEST_URL, AS, {
      // TypeScript prevents this at compile time, but verify at runtime too
      // by casting through unknown
      ...({ resource: "https://evil.com" } as unknown as object),
    } as Parameters<typeof buildProtectedResourceMetadata>[2]);
    expect(doc.resource).toBe(ORIGIN);
    expect(doc.authorization_servers).toEqual([AS]);
  });

  it("handles origin with non-standard port", () => {
    const doc = buildProtectedResourceMetadata("https://api.example.com:8443/mcp", AS);
    expect(doc.resource).toBe("https://api.example.com:8443");
  });
});

describe("buildAuthorizationServerMetadata", () => {
  it("returns the document as-is", () => {
    const meta = {
      issuer: AS,
      token_endpoint: `${AS}/token`,
      authorization_endpoint: `${AS}/authorize`,
    };
    expect(buildAuthorizationServerMetadata(meta)).toEqual(meta);
  });
});

describe("protectedResourceResponse", () => {
  it("returns 200 with application/json content-type", () => {
    const res = protectedResourceResponse(REQUEST_URL, AS);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });

  it("body parses to a valid PR metadata doc", async () => {
    const res = protectedResourceResponse(REQUEST_URL, AS);
    const body = (await res.json()) as {
      resource: string;
      authorization_servers: string[];
    };
    expect(body.resource).toBe(ORIGIN);
    expect(body.authorization_servers).toEqual([AS]);
  });

  it("sets Cache-Control: no-store", () => {
    const res = protectedResourceResponse(REQUEST_URL, AS);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("path constant is correct RFC 9728 well-known path", () => {
    expect(PROTECTED_RESOURCE_PATH).toBe("/.well-known/oauth-protected-resource");
  });
});

describe("authorizationServerResponse", () => {
  const meta = {
    issuer: AS,
    token_endpoint: `${AS}/token`,
  };

  it("returns 200 with application/json content-type", () => {
    const res = authorizationServerResponse(meta);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });

  it("body parses to the supplied metadata document", async () => {
    const res = authorizationServerResponse(meta);
    const body = await res.json();
    expect(body).toEqual(meta);
  });

  it("sets Cache-Control: no-store", () => {
    const res = authorizationServerResponse(meta);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("path constant is correct RFC 8414 well-known path", () => {
    expect(AUTHORIZATION_SERVER_PATH).toBe("/.well-known/oauth-authorization-server");
  });
});
