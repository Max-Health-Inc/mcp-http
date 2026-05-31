/**
 * @maxhealth.tech/mcp-http
 *
 * Framework-agnostic MCP HTTP transport with RFC 9728 OAuth resource-server
 * plumbing. Works on Cloudflare Workers, Pages Functions, Deno Deploy, Bun,
 * Node 18+, and any Hono deployment.
 *
 * @example
 * ```ts
 * import { createMcpHttpHandler, forwardBearer } from '@maxhealth.tech/mcp-http';
 *
 * const handler = createMcpHttpHandler({
 *   authorizationServer: 'https://auth.example.com',
 *   createServer: (token) => buildMyMcpServer({ fetchFn: forwardBearer(token) }),
 * });
 *
 * export default { fetch: handler };
 * ```
 */

// Re-export the config type so consumers can type-check their options objects.
export type {
  McpHttpHandlerConfig,
  PlatformCtx,
  CorsOptions,
  CorsOriginFn,
  McpRequestEvent,
  McpRequestOutcome,
  ProtectedResourceMetadata,
  AuthorizationServerMetadata,
} from "./types.js";

// À la carte primitives — re-exported for consumers that need fine-grained control.
export { extractBearer, isJwtExpired } from "./jwt.js";
export { forwardBearer } from "./fetch.js";
export type { FetchFn } from "./fetch.js";
export { applyCors, handlePreflight } from "./cors.js";
export {
  buildProtectedResourceMetadata,
  buildAuthorizationServerMetadata,
  protectedResourceResponse,
  authorizationServerResponse,
  PROTECTED_RESOURCE_PATH,
  AUTHORIZATION_SERVER_PATH,
} from "./well-known.js";
export { handleMcpPost, handleMcpPostStateful } from "./transport.js";
export type { HandleMcpPostOptions, HandleMcpStatefulOptions } from "./transport.js";
export { SessionStore } from "./session-store.js";
export type { SessionEntry, SessionStoreOptions } from "./session-store.js";
export {
  toJsonRpcErrorBody,
  toJsonRpcErrorResponse,
  JSON_RPC_ERROR_CODES,
} from "./errors.js";
export type {
  JsonRpcErrorObject,
  JsonRpcErrorResponse,
  JsonRpcErrorCode,
} from "./errors.js";

// Core orchestrator
import type { McpHttpHandlerConfig, PlatformCtx } from "./types.js";
import { buildHandler } from "./handler.js";
import type { McpHandler } from "./handler.js";

export type { McpHandler };

/**
 * Create a framework-agnostic `(Request, PlatformCtx?) => Promise<Response>`
 * handler that covers:
 *
 * - CORS (OPTIONS preflight + response headers)
 * - `GET /.well-known/oauth-protected-resource` (RFC 9728)
 * - `GET /.well-known/oauth-authorization-server` (RFC 8414, optional)
 * - Bearer extraction + 401 gate
 * - JWT `exp` early-rejection (opt-out via `earlyRejectExpiredTokens: false`)
 * - MCP `POST /mcp` transport lifecycle
 * - Structured `onRequest` observability hook
 * - Configurable `onError` hook with JSON-RPC 500 fallback
 *
 * @throws {Error} If `authorizationServer` is not a valid URL.
 */
export function createMcpHttpHandler(config: McpHttpHandlerConfig): McpHandler {
  // Validate at construction time — fail loud at the boundary.
  if (config.authorizationServer !== undefined) {
    try {
      new URL(config.authorizationServer);
    } catch {
      throw new Error(
        `[mcp-http] authorizationServer must be a valid URL, got: "${config.authorizationServer}"`,
      );
    }
  }

  const mcpPath = config.mcpPath ?? "/mcp";
  if (!mcpPath.startsWith("/")) {
    throw new Error(`[mcp-http] mcpPath must start with "/", got: "${mcpPath}"`);
  }

  return buildHandler(config);
}

/**
 * Convenience wrapper so consumers can do:
 * ```ts
 * export default { fetch: createMcpHttpHandler(config) };
 * ```
 * The handler signature is compatible with the Cloudflare Workers `fetch` export.
 */
export function createWorkerFetch(
  config: McpHttpHandlerConfig,
): (
  req: Request,
  env?: unknown,
  ctx?: { waitUntil?: (p: Promise<unknown>) => void },
) => Promise<Response> {
  const handler = createMcpHttpHandler(config);
  return (
    req: Request,
    env?: unknown,
    ctx?: { waitUntil?: (p: Promise<unknown>) => void },
  ): Promise<Response> => {
    const platformCtx: Omit<PlatformCtx, "request"> = { env };
    if (ctx?.waitUntil !== undefined) {
      platformCtx.waitUntil = ctx.waitUntil;
    }
    return handler(req, platformCtx);
  };
}
