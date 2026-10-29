/** Decoding only, no signature verification: the upstream API stays the authoritative validator. */

const CLOCK_SKEW_SECONDS = 30;

/** Extract the Bearer token from an `Authorization` header, or `null` when absent, another scheme, or empty. */
export function extractBearer(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null;
  const trimmed = authorizationHeader.trim();
  // Case-insensitive per RFC 6750 §2.1
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  const token = trimmed.slice("bearer ".length).trim();
  return token.length > 0 ? token : null;
}

interface JwtPayload {
  exp?: unknown;
  [key: string]: unknown;
}

/** Unverified payload decode; unexported so an unverified claim never reaches an authorization decision. */
function decodeJwtPayload(token: string): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const payloadSegment = parts[1];
  if (!payloadSegment) return null;

  // atob yields latin1; decode the bytes as strict UTF-8 instead.
  const base64 = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
  let jsonStr: string;
  try {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    jsonStr = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
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

/** True only when a numeric `exp` is past the skew buffer; opaque, malformed or exp-less tokens return false. */
export function isJwtExpired(token: string): boolean {
  const payload = decodeJwtPayload(token.trim());
  if (payload === null) return false;
  if (!("exp" in payload)) return false;

  const exp = payload.exp;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return false;

  const nowSeconds = Math.floor(Date.now() / 1000);
  return exp < nowSeconds - CLOCK_SKEW_SECONDS;
}
