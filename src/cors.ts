import type { CorsOptions } from "./types.js";

/**
 * MCP-required request headers (per the MCP HTTP transport spec).
 * Clients must be able to send all of these.
 */
const MCP_ALLOW_HEADERS = [
  "Content-Type",
  "Authorization",
  "Mcp-Session-Id",
  "Last-Event-ID",
] as const;

/**
 * MCP-required response headers that should be exposed to browser clients.
 */
const MCP_EXPOSE_HEADERS = ["Mcp-Session-Id"] as const;

const DEFAULT_MAX_AGE = 600;

/** Resolve the `Access-Control-Allow-Origin` value for a given request. */
function resolveOrigin(req: Request, origin: CorsOptions["origin"]): string | null {
  if (origin === undefined || origin === "*") return "*";
  if (typeof origin === "string") return origin;
  if (typeof origin === "function") return origin(req);

  // Array of allowed origins — echo back the request origin if matched
  const requestOrigin = req.headers.get("Origin");
  if (requestOrigin !== null && origin.includes(requestOrigin)) {
    return requestOrigin;
  }
  return null;
}

/**
 * Apply CORS headers to an existing (mutable) `Headers` instance.
 *
 * Call this on every response, including error responses, so that browser
 * clients can read the error body.
 */
export function applyCors(headers: Headers, req: Request, options: CorsOptions): void {
  const allowedOrigin = resolveOrigin(req, options.origin);
  if (allowedOrigin !== null) {
    headers.set("Access-Control-Allow-Origin", allowedOrigin);
    // Vary must include Origin when a specific origin is echoed back
    if (allowedOrigin !== "*") {
      const vary = headers.get("Vary");
      headers.set("Vary", vary ? `${vary}, Origin` : "Origin");
    }
  }

  if (options.credentials === true) {
    headers.set("Access-Control-Allow-Credentials", "true");
  }

  const allowHeaders = [...MCP_ALLOW_HEADERS, ...(options.allowHeaders ?? [])].join(", ");
  headers.set("Access-Control-Allow-Headers", allowHeaders);

  const exposeHeaders = [...MCP_EXPOSE_HEADERS, ...(options.exposeHeaders ?? [])].join(
    ", ",
  );
  headers.set("Access-Control-Expose-Headers", exposeHeaders);
}

/**
 * Build a `Response` for an HTTP OPTIONS preflight request.
 *
 * Returns `null` when CORS is disabled (`false`) — the caller should treat a
 * `null` result as a normal request to be routed.
 */
export function handlePreflight(
  req: Request,
  corsConfig: false | CorsOptions,
): Response | null {
  if (corsConfig === false) return null;

  const headers = new Headers();
  applyCors(headers, req, corsConfig);

  headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  headers.set("Access-Control-Max-Age", String(corsConfig.maxAge ?? DEFAULT_MAX_AGE));

  return new Response(null, { status: 204, headers });
}
