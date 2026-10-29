/** Framework-agnostic MCP HTTP transport with RFC 9728 OAuth resource-server plumbing. */

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

export { extractBearer, isJwtExpired } from "./jwt.js";
export { forwardBearer } from "./fetch.js";
export type { FetchFn } from "./fetch.js";
export {
  applyCors,
  handlePreflight,
  isOriginAllowed,
  MCP_EXPOSED_RESPONSE_HEADERS,
  MCP_PARAM_HEADER_PREFIX,
  MCP_REQUEST_HEADERS,
} from "./cors.js";
export type { PreflightRouteOptions } from "./cors.js";
export { DEFAULT_MCP_PATH, allowedMethodsFor, allowMethodsValue } from "./routes.js";
export {
  buildProtectedResourceMetadata,
  buildAuthorizationServerMetadata,
  protectedResourceResponse,
  authorizationServerResponse,
  PROTECTED_RESOURCE_PATH,
  AUTHORIZATION_SERVER_PATH,
  protectedResourcePath,
} from "./well-known.js";
export { handleMcpPost } from "./transport.js";
export type { HandleMcpPostOptions } from "./transport.js";
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

import type { McpHttpHandlerConfig, PlatformCtx } from "./types.js";
import { buildHandler } from "./handler.js";
import type { McpHandler } from "./handler.js";

export type { McpHandler };

/**
 * Create a `(Request, PlatformCtx?) => Promise<Response>` handler: CORS, well-known metadata, Bearer gate, MCP transport, hooks.
 * @throws {Error} If `authorizationServer` is not a valid URL or `mcpPath` lacks a leading `/`.
 */
export function createMcpHttpHandler<Env = unknown>(
  config: McpHttpHandlerConfig<Env>,
): McpHandler {
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

/** Workers-style `fetch(req, env, ctx)` wrapper: `export default { fetch: createWorkerFetch<Env>({ ... }) }`. */
export function createWorkerFetch<Env = unknown>(
  config: McpHttpHandlerConfig<Env>,
): (
  req: Request,
  env?: Env,
  ctx?: { waitUntil?: (p: Promise<unknown>) => void },
) => Promise<Response> {
  const handler = createMcpHttpHandler(config);
  return (
    req: Request,
    env?: Env,
    ctx?: { waitUntil?: (p: Promise<unknown>) => void },
  ): Promise<Response> => {
    const platformCtx: Omit<PlatformCtx, "request"> = { env };
    if (ctx?.waitUntil !== undefined) {
      platformCtx.waitUntil = ctx.waitUntil;
    }
    return handler(req, platformCtx);
  };
}
