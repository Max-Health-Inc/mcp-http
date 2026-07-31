import {
  PROTECTED_RESOURCE_PATH,
  AUTHORIZATION_SERVER_PATH,
  protectedResourcePath,
} from "./well-known.js";

/** Default path the MCP endpoint is mounted on when `mcpPath` is not configured. */
export const DEFAULT_MCP_PATH = "/mcp";

/**
 * Single source of truth for which HTTP methods each route accepts.
 *
 * Both the `405` `Allow` header in the request handler and the preflight
 * `Access-Control-Allow-Methods` header derive from this, so a browser is
 * never told it may use a method the endpoint will reject.
 *
 * `OPTIONS` is deliberately excluded — it is a CORS concern, not a route
 * concern, and is appended by {@link allowMethodsValue} only when CORS is
 * enabled.
 *
 * @returns The accepted methods, or an empty array for an unrouted path.
 */
export function allowedMethodsFor(
  pathname: string,
  mcpPath: string = DEFAULT_MCP_PATH,
): readonly string[] {
  if (pathname === mcpPath) return ["POST"];
  if (
    pathname === protectedResourcePath(mcpPath) ||
    pathname === PROTECTED_RESOURCE_PATH ||
    pathname === AUTHORIZATION_SERVER_PATH
  ) {
    return ["GET"];
  }
  return [];
}

/**
 * Render the header value for `Allow` / `Access-Control-Allow-Methods`.
 *
 * `OPTIONS` is only advertised when CORS is enabled, because that is the only
 * configuration in which the handler answers an OPTIONS request.
 */
export function allowMethodsValue(
  methods: readonly string[],
  corsEnabled: boolean,
): string {
  return (corsEnabled ? [...methods, "OPTIONS"] : methods).join(", ");
}
