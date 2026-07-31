import { getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/server";
import type { AuthorizationServerMetadata, ProtectedResourceMetadata } from "./types.js";

const WELL_KNOWN_PR = "/.well-known/oauth-protected-resource";
const WELL_KNOWN_AS = "/.well-known/oauth-authorization-server";

/**
 * Origin used only to borrow the SDK's path rule. `getOAuthProtectedResourceMetadataUrl`
 * works in absolute URLs, but this package's routing works in pathnames, so a
 * throwaway origin is attached and then discarded. `.invalid` is reserved by
 * RFC 2606 and can never resolve.
 */
const PATH_ONLY_ORIGIN = "https://x.invalid";

/**
 * Build the RFC 9728 Protected Resource Metadata document.
 *
 * `resource` is the full URL of the protected resource (origin + path),
 * per RFC 9728 §2. `authorization_servers` always contains exactly the
 * configured AS base URL.
 *
 * Consumer-supplied extra fields are merged in, but `resource` and
 * `authorization_servers` cannot be overridden.
 *
 * **Why this is not delegated to the SDK.** The obvious move is to call
 * `buildOAuthProtectedResourceMetadata`, but its `AuthMetadataOptions` requires a
 * full RFC 8414 `oauthMetadata` document (`authorization_endpoint`,
 * `token_endpoint`, `response_types_supported`) while this package is configured
 * with only an AS base URL. The SDK reads nothing but `issuer` from it, so
 * delegating would mean fabricating three endpoint values that are discarded —
 * and that would silently start leaking invented endpoints if a future SDK
 * version began emitting them. The document is three fields; owning it is safer
 * than contorting the call. The *route*, which is the subtle part, is delegated
 * via {@link protectedResourcePath}.
 *
 * @deprecated Prefer `buildOAuthProtectedResourceMetadata` from
 * `@modelcontextprotocol/server`, passing your real AS metadata document. This
 * wrapper exists so code written against `mcp-http` 0.2.x keeps working, and
 * will be removed in 0.4.0.
 * @see {@link https://www.npmjs.com/package/@modelcontextprotocol/server | @modelcontextprotocol/server}
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

/**
 * Pathname for the protected-resource well-known document, with no resource
 * path component.
 *
 * This is the correct route only for a resource mounted at the origin root.
 * For any other mount point use {@link protectedResourcePath}, which applies
 * the RFC 9728 §3.1 path-insertion rule. This constant remains exported, and
 * remains served, as a compatibility alias for clients that probe the bare
 * path.
 */
export const PROTECTED_RESOURCE_PATH = WELL_KNOWN_PR;

/** Pathname for the authorization-server well-known document. */
export const AUTHORIZATION_SERVER_PATH = WELL_KNOWN_AS;

/**
 * Apply the RFC 9728 §3.1 path-insertion rule for a resource mount point.
 *
 * The well-known segment is inserted between the host and the resource's path,
 * so a resource at `https://api.example.com/mcp` publishes its metadata at
 * `https://api.example.com/.well-known/oauth-protected-resource/mcp`, not at
 * the bare well-known path.
 *
 * A root-mounted resource (`/` or empty) has no path component to insert and
 * yields the bare path.
 *
 * Delegates to `getOAuthProtectedResourceMetadataUrl` from
 * `@modelcontextprotocol/server` so this package's route can never drift from
 * the SDK's interpretation of the rule.
 *
 * @param mcpPath Path the MCP endpoint is mounted on, e.g. `/mcp`.
 * @returns The pathname the metadata document should be served from.
 */
export function protectedResourcePath(mcpPath: string): string {
  const resource = new URL(mcpPath === "" ? "/" : mcpPath, PATH_ONLY_ORIGIN);
  return new URL(getOAuthProtectedResourceMetadataUrl(resource)).pathname;
}
