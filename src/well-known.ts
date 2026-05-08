import type { AuthorizationServerMetadata, ProtectedResourceMetadata } from "./types.js";

const WELL_KNOWN_PR = "/.well-known/oauth-protected-resource";
const WELL_KNOWN_AS = "/.well-known/oauth-authorization-server";

/**
 * Build the RFC 9728 Protected Resource Metadata document.
 *
 * `resource` is the full URL of the protected resource (origin + path),
 * per RFC 9728 §2. `authorization_servers` always contains exactly the
 * configured AS base URL.
 *
 * Consumer-supplied extra fields are merged in, but `resource` and
 * `authorization_servers` cannot be overridden.
 */
export function buildProtectedResourceMetadata(
  resourceUrl: string,
  authorizationServer: string,
  extra?: Partial<Omit<ProtectedResourceMetadata, "resource" | "authorization_servers">>,
): ProtectedResourceMetadata {
  return {
    ...(extra ?? {}),
    resource: resourceUrl,
    authorization_servers: [authorizationServer],
  };
}

/**
 * Build the RFC 8414 Authorization Server Metadata document for proxying.
 *
 * The supplied document is returned as-is; this function exists so callers
 * can rely on the typed signature and consistent content-type handling.
 */
export function buildAuthorizationServerMetadata(
  metadata: AuthorizationServerMetadata,
): AuthorizationServerMetadata {
  return metadata;
}

/**
 * Build a JSON `Response` for `GET /.well-known/oauth-protected-resource`.
 */
export function protectedResourceResponse(
  requestUrl: string,
  authorizationServer: string,
  extra?: Partial<Omit<ProtectedResourceMetadata, "resource" | "authorization_servers">>,
): Response {
  const body = buildProtectedResourceMetadata(requestUrl, authorizationServer, extra);
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Build a JSON `Response` for `GET /.well-known/oauth-authorization-server`.
 */
export function authorizationServerResponse(
  metadata: AuthorizationServerMetadata,
): Response {
  return new Response(JSON.stringify(metadata), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

/** Pathname for the protected-resource well-known document. */
export const PROTECTED_RESOURCE_PATH = WELL_KNOWN_PR;

/** Pathname for the authorization-server well-known document. */
export const AUTHORIZATION_SERVER_PATH = WELL_KNOWN_AS;
