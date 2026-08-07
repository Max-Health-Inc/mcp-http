import type { CorsOptions } from "./types.js";
import { allowedMethodsFor, allowMethodsValue } from "./routes.js";

/**
 * MCP-required request headers. None are CORS-safelisted, so omitting any of
 * them fails preflight for every browser-hosted client.
 */
const MCP_ALLOW_HEADERS = [
  "Content-Type",
  "Authorization",
  "MCP-Protocol-Version",
  // Required POST headers as of 2026-07-28. Request headers, so not exposed.
  "Mcp-Method",
  "Mcp-Name",
  // 2025-era: the spec says ignore, not reject. Omitting them fails preflight,
  // which would block the legacy clients we still serve.
  "Mcp-Session-Id",
  "Last-Event-ID",
] as const;

/** Exposed response headers. Empty since sessions were removed. */
const MCP_EXPOSE_HEADERS: readonly string[] = [];

/**
 * Prefix for the per-tool parameter headers introduced by SEP-2243.
 *
 * A server may mirror any tool parameter into `Mcp-Param-{Name}`, and a
 * conforming client MUST send it. The names are chosen per tool at runtime, so
 * no fixed list can cover them — they are admitted by prefix instead.
 */
const MCP_PARAM_HEADER_PREFIX = "mcp-param-";

const DEFAULT_MAX_AGE = 600;

/**
 * Resolve `Access-Control-Allow-Headers` for a request.
 *
 * Returns the static list, plus any `Mcp-Param-*` headers the client asked for
 * in `Access-Control-Request-Headers`. Only the documented prefix is echoed —
 * arbitrary requested headers are not reflected.
 */
function resolveAllowHeaders(req: Request, options: CorsOptions): string {
  const base: string[] = [...MCP_ALLOW_HEADERS, ...(options.allowHeaders ?? [])];

  const requested = req.headers.get("Access-Control-Request-Headers");
  if (requested === null) return base.join(", ");

  const known = new Set(base.map((h) => h.toLowerCase()));
  const params: string[] = [];

  for (const raw of requested.split(",")) {
    const name = raw.trim();
    const lower = name.toLowerCase();
    if (name === "" || known.has(lower)) continue;
    if (!lower.startsWith(MCP_PARAM_HEADER_PREFIX)) continue;
    known.add(lower);
    params.push(name);
  }

  return [...base, ...params].join(", ");
}

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
 *
 * @throws {Error} When `credentials: true` is combined with a wildcard origin
 * (`"*"` or `undefined`). Browsers reject this combination (RFC 6454 / Fetch
 * spec), and emitting both headers is misleading to non-browser clients.
 * Use an explicit origin string or array when `credentials: true`.
 */
export function applyCors(headers: Headers, req: Request, options: CorsOptions): void {
  // Guard: credentials:true + wildcard origin is spec-invalid and silently
  // broken in browsers — fail loudly so misconfiguration is caught early.
  if (
    options.credentials === true &&
    (options.origin === "*" || options.origin === undefined)
  ) {
    throw new Error(
      "[mcp-http] CORS misconfiguration: credentials: true requires an explicit non-wildcard origin. " +
        'Set cors.origin to a string or string[] (e.g. ["https://app.example.com"]) when using credentials: true.',
    );
  }

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

  headers.set("Access-Control-Allow-Headers", resolveAllowHeaders(req, options));

  const exposeHeaders = [...MCP_EXPOSE_HEADERS, ...(options.exposeHeaders ?? [])];
  // Omit the header entirely rather than emitting a bare empty value.
  if (exposeHeaders.length > 0) {
    headers.set("Access-Control-Expose-Headers", exposeHeaders.join(", "));
  }
}

/** Route context needed to advertise accurate preflight methods. */
export interface PreflightRouteOptions {
  /** Path the MCP endpoint is mounted on. Defaults to `/mcp`. */
  mcpPath?: string;
}

/**
 * Build a `Response` for an HTTP OPTIONS preflight request.
 *
 * `Access-Control-Allow-Methods` is derived per route from the same table the
 * request handler uses for its `405` `Allow` header, so preflight never
 * advertises a method the endpoint would reject.
 *
 * Returns `null` when CORS is disabled (`false`) — the caller should treat a
 * `null` result as a normal request to be routed.
 */
export function handlePreflight(
  req: Request,
  corsConfig: false | CorsOptions,
  options: PreflightRouteOptions = {},
): Response | null {
  if (corsConfig === false) return null;

  const headers = new Headers();
  applyCors(headers, req, corsConfig);

  const { pathname } = new URL(req.url);
  const methods = allowedMethodsFor(pathname, options.mcpPath);
  headers.set("Access-Control-Allow-Methods", allowMethodsValue(methods, true));
  headers.set("Access-Control-Max-Age", String(corsConfig.maxAge ?? DEFAULT_MAX_AGE));

  return new Response(null, { status: 204, headers });
}
