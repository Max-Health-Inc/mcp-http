import { describe, it, expect } from "bun:test";
import { extractBearer, isJwtExpired } from "../src/jwt.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const body = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${header}.${body}.fakesignature`;
}

/** Base64URL-encode raw bytes (btoa alone cannot carry multi-byte payloads). */
function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Build a JWT whose payload is encoded as real UTF-8. */
function makeUtf8Jwt(payload: Record<string, unknown>): string {
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: "HS256" })));
  const body = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${header}.${body}.fakesignature`;
}

const nowSec = (): number => Math.floor(Date.now() / 1000);

// ---------------------------------------------------------------------------
// extractBearer
// ---------------------------------------------------------------------------

describe("extractBearer", () => {
  it("returns null for null input", () => {
    expect(extractBearer(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractBearer("")).toBeNull();
  });

  it("returns null for non-Bearer scheme", () => {
    expect(extractBearer("Basic dXNlcjpwYXNz")).toBeNull();
  });

  it("returns null for bare 'Bearer' with no token", () => {
    expect(extractBearer("Bearer ")).toBeNull();
    expect(extractBearer("Bearer")).toBeNull();
  });

  it("extracts a simple token", () => {
    expect(extractBearer("Bearer mytoken123")).toBe("mytoken123");
  });

  it("is case-insensitive on the scheme", () => {
    expect(extractBearer("BEARER mytoken")).toBe("mytoken");
    expect(extractBearer("bearer mytoken")).toBe("mytoken");
    expect(extractBearer("Bearer mytoken")).toBe("mytoken");
  });

  it("trims leading/trailing whitespace from the header value", () => {
    expect(extractBearer("  Bearer mytoken  ")).toBe("mytoken");
  });

  it("handles a realistic JWT token", () => {
    const jwt = makeJwt({ sub: "user", exp: nowSec() + 300 });
    expect(extractBearer(`Bearer ${jwt}`)).toBe(jwt);
  });
});

// ---------------------------------------------------------------------------
// isJwtExpired
// ---------------------------------------------------------------------------

describe("isJwtExpired", () => {
  it("returns false for a valid token with future exp", () => {
    const jwt = makeJwt({ sub: "user", exp: nowSec() + 3600 });
    expect(isJwtExpired(jwt)).toBe(false);
  });

  it("returns true for a token with exp clearly in the past", () => {
    // Past by 120s — well outside the 30s clock-skew buffer
    const jwt = makeJwt({ exp: nowSec() - 120 });
    expect(isJwtExpired(jwt)).toBe(true);
  });

  it("returns false when exp is exactly at the clock-skew boundary (now - 30s)", () => {
    // exp = now - 30s: the token is at the buffer edge → NOT expired
    const jwt = makeJwt({ exp: nowSec() - 30 });
    expect(isJwtExpired(jwt)).toBe(false);
  });

  it("returns true when exp is one second past the clock-skew buffer (now - 31s)", () => {
    const jwt = makeJwt({ exp: nowSec() - 31 });
    expect(isJwtExpired(jwt)).toBe(true);
  });

  it("returns false when exp is exactly now", () => {
    const jwt = makeJwt({ exp: nowSec() });
    expect(isJwtExpired(jwt)).toBe(false);
  });

  it("returns false when the token has no exp claim", () => {
    const jwt = makeJwt({ sub: "user" });
    expect(isJwtExpired(jwt)).toBe(false);
  });

  it("returns false when exp is not a number (string)", () => {
    const jwt = makeJwt({ exp: "not-a-number" });
    expect(isJwtExpired(jwt)).toBe(false);
  });

  it("returns false when exp is null", () => {
    const jwt = makeJwt({ exp: null });
    expect(isJwtExpired(jwt)).toBe(false);
  });

  it("returns false for a token with only two segments (malformed)", () => {
    expect(isJwtExpired("header.payload")).toBe(false);
  });

  it("returns false for a token with non-base64 payload", () => {
    expect(isJwtExpired("header.!!!.sig")).toBe(false);
  });

  it("returns false for a token with non-JSON payload", () => {
    const badPayload = btoa("not json").replace(/=/g, "");
    expect(isJwtExpired(`hdr.${badPayload}.sig`)).toBe(false);
  });

  it("handles leading whitespace in the token string", () => {
    const jwt = makeJwt({ exp: nowSec() - 120 });
    expect(isJwtExpired(`  ${jwt}`)).toBe(true);
  });

  it("returns false for exp = Infinity", () => {
    const jwt = makeJwt({ exp: Infinity });
    expect(isJwtExpired(jwt)).toBe(false);
  });

  it("returns false for exp = NaN", () => {
    const jwt = makeJwt({ exp: NaN });
    expect(isJwtExpired(jwt)).toBe(false);
  });

  it("reads exp from a payload carrying multi-byte claims", () => {
    const jwt = makeUtf8Jwt({ name: "Müller", org: "Ärzte 東京", exp: nowSec() - 120 });
    expect(isJwtExpired(jwt)).toBe(true);
  });

  it("rejects a payload that is invalid UTF-8 but parses as latin1", () => {
    // 0xFF is not valid UTF-8, yet reading it as latin1 yields a well-formed
    // JSON document with a live exp. Decoding as latin1 would trust it.
    const head = new TextEncoder().encode(`{"exp":${nowSec() - 120},"n":"`);
    const tail = new TextEncoder().encode(`"}`);
    const bytes = Uint8Array.from([...head, 0xff, ...tail]);
    expect(isJwtExpired(`hdr.${base64url(bytes)}.sig`)).toBe(false);
  });
});
