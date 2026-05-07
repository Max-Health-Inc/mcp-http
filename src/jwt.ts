/**
 * Pure, dependency-free JWT utilities.
 *
 * These functions perform BASE64URL decoding and JSON parsing only —
 * they do NOT verify signatures or validate claims beyond `exp`.
 * Signature verification is intentionally delegated to the upstream API.
 */

/** Clock-skew buffer applied to `exp` checks (in seconds). */
const CLOCK_SKEW_SECONDS = 30;

/**
 * Extract the Bearer token string from an `Authorization` header value.
 *
 * Returns `null` when the header is absent, not a Bearer scheme, or the
 * token portion is empty after trimming.
 */
export function extractBearer(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null;
  const trimmed = authorizationHeader.trim();
  // Case-insensitive prefix match per RFC 6750 §2.1
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  const token = trimmed.slice("bearer ".length).trim();
  return token.length > 0 ? token : null;
}

interface JwtPayload {
  exp?: unknown;
  [key: string]: unknown;
}

/**
 * Decode the payload segment of a JWT without verifying the signature.
 *
 * Returns `null` when the token is structurally invalid (not three dot-separated
 * segments, non-base64url payload, non-JSON payload).
 */
function decodeJwtPayload(token: string): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const payloadSegment = parts[1];
  if (!payloadSegment) return null;

  // Base64URL → Base64 → binary → UTF-8
  const base64 = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
  let jsonStr: string;
  try {
    jsonStr = atob(base64);
  } catch {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(jsonStr);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * Check whether a JWT's `exp` claim is in the past.
 *
 * - Returns `false` (not expired) when the token is opaque, structurally
 *   malformed, or has no `exp` claim — callers should let the upstream API
 *   decide in those cases.
 * - Returns `true` only when a numeric `exp` value is definitively in the
 *   past (accounting for {@link CLOCK_SKEW_SECONDS}).
 */
export function isJwtExpired(token: string): boolean {
  const payload = decodeJwtPayload(token.trim());
  if (payload === null) return false;
  if (!("exp" in payload)) return false;

  const exp = payload.exp;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return false;

  const nowSeconds = Math.floor(Date.now() / 1000);
  return exp < nowSeconds - CLOCK_SKEW_SECONDS;
}
