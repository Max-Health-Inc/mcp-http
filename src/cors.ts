import type { CorsOptions } from "./types.js";
import { allowedMethodsFor, allowMethodsValue } from "./routes.js";

/** Request headers a browser MCP client sends; none are CORS-safelisted, so each must be allowed. */
export const MCP_REQUEST_HEADERS = [
  "Content-Type",
  "Authorization",
  "MCP-Protocol-Version",
  // Required POST headers as of 2026-07-28. Request headers, so not exposed.
  "Mcp-Method",
  "Mcp-Name",
  // 2025-era headers: still allowed so legacy clients pass preflight.
  "Mcp-Session-Id",
  "Last-Event-ID",
] as const;

/** Response headers a browser client must read; it MUST take `resource_metadata` from a 401's `WWW-Authenticate`. */
export const MCP_EXPOSED_RESPONSE_HEADERS = ["WWW-Authenticate"] as const;

/** Prefix of the SEP-2243 per-tool `Mcp-Param-{Name}` headers, admitted by prefix since names vary per tool. */
export const MCP_PARAM_HEADER_PREFIX = "mcp-param-";

const DEFAULT_MAX_AGE = 600;

/** Static allow-list plus requested `Mcp-Param-*` headers; other requested headers are never reflected. */
function resolveAllowHeaders(req: Request, options: CorsOptions): string {
  const base: string[] = [...MCP_REQUEST_HEADERS, ...(options.allowHeaders ?? [])];

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

/**
 * Whether the policy permits this request's `Origin`; an absent `Origin` (non-browser caller) is allowed.
 * A disallowed origin gets a 403, since withholding the header alone still runs the request (DNS rebinding).
 */
export function isOriginAllowed(req: Request, options: CorsOptions): boolean {
  const requestOrigin = req.headers.get("Origin");
  if (requestOrigin === null) return true;

  const { origin } = options;
  if (origin === undefined || origin === "*") return true;
  if (typeof origin === "string") return origin === "*" || origin === requestOrigin;
  if (typeof origin === "function") {
    const resolved = origin(req);
    return resolved !== null && (resolved === "*" || resolved === requestOrigin);
  }
  return origin.includes(requestOrigin);
}

/** Resolve the `Access-Control-Allow-Origin` value for a given request. */
function resolveOrigin(req: Request, origin: CorsOptions["origin"]): string | null {
  if (origin === undefined || origin === "*") return "*";
  if (typeof origin === "string") return origin;
  if (typeof origin === "function") return origin(req);

  const requestOrigin = req.headers.get("Origin");
  if (requestOrigin !== null && origin.includes(requestOrigin)) {
    return requestOrigin;
  }
  return null;
}

/** Add a field to a Vary list once, case-insensitively; `*` already covers it (RFC 9110 §12.5.5). */
function withVaryField(vary: string | null, field: string): string {
  const fields = (vary ?? "")
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
  if (fields.includes("*")) return "*";
  if (fields.some((f) => f.toLowerCase() === field.toLowerCase()))
    return fields.join(", ");
  return [...fields, field].join(", ");
}

/**
 * Apply CORS headers to a mutable `Headers`; call it on error responses too.
 * @throws {Error} When `credentials: true` is combined with a wildcard origin, which browsers reject.
 */
export function applyCors(headers: Headers, req: Request, options: CorsOptions): void {
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
    if (allowedOrigin !== "*")
      headers.set("Vary", withVaryField(headers.get("Vary"), "Origin"));
  }

  if (options.credentials === true) {
    headers.set("Access-Control-Allow-Credentials", "true");
  }

  headers.set("Access-Control-Allow-Headers", resolveAllowHeaders(req, options));

  const exposeHeaders = [
    ...MCP_EXPOSED_RESPONSE_HEADERS,
    ...(options.exposeHeaders ?? []),
  ];
  if (exposeHeaders.length > 0) {
    headers.set("Access-Control-Expose-Headers", exposeHeaders.join(", "));
  }
}

/** Route context needed to advertise accurate preflight methods. */
export interface PreflightRouteOptions {
  /** Defaults to `/mcp`. */
  mcpPath?: string;
}

/**
 * Build the OPTIONS preflight `Response`, or `null` when CORS is disabled.
 * Allowed methods come from the same route table as the `405` `Allow` header.
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
