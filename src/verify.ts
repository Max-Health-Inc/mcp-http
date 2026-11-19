import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

const CLOCK_SKEW_SECONDS = 30;

const keySets = new Map<string, JWTVerifyGetKey>();

function keySetFor(jwksUri: string): JWTVerifyGetKey {
  const cached = keySets.get(jwksUri);
  if (cached) return cached;
  const keys = createRemoteJWKSet(new URL(jwksUri));
  keySets.set(jwksUri, keys);
  return keys;
}

export interface AccessTokenExpectations {
  jwksUri: string;
  issuers: readonly string[];
  audience?: string;
}

/** True when the JWT's signature verifies against `jwksUri` and its `iss`, `exp` and `aud` hold. */
export async function isVerifiedAccessToken(
  token: string,
  expected: AccessTokenExpectations,
): Promise<boolean> {
  try {
    await jwtVerify(token, keySetFor(expected.jwksUri), {
      issuer: [...expected.issuers],
      requiredClaims: ["exp"],
      clockTolerance: CLOCK_SKEW_SECONDS,
      ...(expected.audience !== undefined ? { audience: expected.audience } : {}),
    });
    return true;
  } catch {
    return false;
  }
}
