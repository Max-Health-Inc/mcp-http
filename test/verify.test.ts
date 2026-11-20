import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey, type JWK } from "jose";
import { emptyServer } from "./helpers/server.js";
import { createMcpHttpHandler } from "../src/index.js";
import type { McpHttpHandlerConfig } from "../src/types.js";

const AS = "https://auth.example.com";
const TOKEN_ISSUER = "https://idp.example.com/realms/main";
const BASE = "https://api.example.com";
const RESOURCE = `${BASE}/mcp`;
const JWKS_URI = `${AS}/.well-known/jwks.json`;

let signingKey: CryptoKey;
let strangerKey: CryptoKey;
let publicJwk: JWK;
let jwksRequests = 0;
const originalFetch = globalThis.fetch;

beforeAll(async () => {
  const pair = await generateKeyPair("ES256");
  signingKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "ES256" };
  strangerKey = (await generateKeyPair("ES256")).privateKey;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === JWKS_URI) {
      jwksRequests += 1;
      return Promise.resolve(Response.json({ keys: [publicJwk] }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  }) as typeof globalThis.fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

async function token(
  claims: Record<string, unknown>,
  key: CryptoKey = signingKey,
  expiresIn = "1h",
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "ES256", kid: "k1" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

function handler(overrides: Partial<McpHttpHandlerConfig> = {}) {
  return createMcpHttpHandler({
    authorizationServer: AS,
    authorizationServerMetadata: { issuer: AS, jwks_uri: JWKS_URI },
    createServer: () => emptyServer(),
    verifyAccessTokens: true,
    requireResourceAudience: true,
    ...overrides,
  });
}

function call(bearer: string): Request {
  return new Request(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  });
}

describe("verifyAccessTokens", () => {
  it("serves a token the authorization server signed for this resource", async () => {
    const res = await handler()(call(await token({ iss: AS, aud: RESOURCE, sub: "u1" })));
    expect(res.status).not.toBe(401);
    expect(jwksRequests).toBeGreaterThan(0);
  });

  it("challenges a token signed by a key the authorization server does not publish", async () => {
    const res = await handler()(
      call(await token({ iss: AS, aud: RESOURCE, sub: "u1" }, strangerKey)),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain('error="invalid_token"');
  });

  it("challenges a forged token whatever its claims say", async () => {
    const forged = (await token({ iss: AS, aud: RESOURCE, sub: "u1" })).replace(
      /\.[^.]+$/,
      ".AAAA",
    );
    expect((await handler()(call(forged))).status).toBe(401);
    expect((await handler()(call("opaque-token"))).status).toBe(401);
  });

  it("challenges a token issued for another resource", async () => {
    const res = await handler()(
      call(await token({ iss: AS, aud: "https://fhir.example.com/R4", sub: "u1" })),
    );
    expect(res.status).toBe(401);
  });

  it("accepts a further issuer only when the deployment names it", async () => {
    const minted = await token({ iss: TOKEN_ISSUER, aud: RESOURCE, sub: "u1" });
    expect((await handler()(call(minted))).status).toBe(401);
    expect(
      (await handler({ verifyAccessTokens: { issuers: [TOKEN_ISSUER] } })(call(minted)))
        .status,
    ).not.toBe(401);
    expect(
      (
        await handler({
          verifyAccessTokens: { issuers: () => Promise.resolve([TOKEN_ISSUER]) },
        })(call(minted))
      ).status,
    ).not.toBe(401);
  });

  it("leaves aud alone without requireResourceAudience", async () => {
    const res = await handler({ requireResourceAudience: false })(
      call(await token({ iss: AS, aud: "https://elsewhere.example.com", sub: "u1" })),
    );
    expect(res.status).not.toBe(401);
  });

  it("refuses to serve when the signing keys cannot be located", async () => {
    const res = await createMcpHttpHandler({
      authorizationServer: AS,
      authorizationServerMetadata: { issuer: AS },
      createServer: () => emptyServer(),
      verifyAccessTokens: true,
    })(call(await token({ iss: AS, aud: RESOURCE, sub: "u1" })));
    expect(res.status).toBe(503);
  });
});
