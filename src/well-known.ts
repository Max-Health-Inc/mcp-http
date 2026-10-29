import { getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/server";
import type { AuthorizationServerMetadata, ProtectedResourceMetadata } from "./types.js";

const WELL_KNOWN_PR = "/.well-known/oauth-protected-resource";
const WELL_KNOWN_AS = "/.well-known/oauth-authorization-server";

/** Throwaway origin for the SDK's URL-based path rule; `.invalid` (RFC 2606) never resolves. */
const PATH_ONLY_ORIGIN = "https://x.invalid";

/**
 * Build the RFC 9728 Protected Resource Metadata document; `extra` cannot override `resource` or `authorization_servers`.
 * Not delegated to the SDK because its builder needs a full RFC 8414 document this package does not have.
 *
 * @deprecated Prefer `buildOAuthProtectedResourceMetadata` from `@modelcontextprotocol/server`.
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

/** Typed identity for an RFC 8414 Authorization Server Metadata document. */
export function buildAuthorizationServerMetadata(
  metadata: AuthorizationServerMetadata,
): AuthorizationServerMetadata {
  return metadata;
}

/** Build a JSON `Response` for `GET /.well-known/oauth-protected-resource`. */
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

/** Build a JSON `Response` for `GET /.well-known/oauth-authorization-server`. */
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

/** Bare protected-resource well-known path; correct only for a root mount, see {@link protectedResourcePath}. */
export const PROTECTED_RESOURCE_PATH = WELL_KNOWN_PR;

/** Pathname for the authorization-server well-known document. */
export const AUTHORIZATION_SERVER_PATH = WELL_KNOWN_AS;

/**
 * Apply the RFC 9728 §3.1 path-insertion rule: `/mcp` publishes at `/.well-known/oauth-protected-resource/mcp`.
 * Delegates to the SDK so the route cannot drift from its reading of the rule.
 */
export function protectedResourcePath(mcpPath: string): string {
  const resource = new URL(mcpPath === "" ? "/" : mcpPath, PATH_ONLY_ORIGIN);
  return new URL(getOAuthProtectedResourceMetadataUrl(resource)).pathname;
}
