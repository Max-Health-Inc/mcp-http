import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// ---------------------------------------------------------------------------
// OAuth / RFC 8414 + RFC 9728 metadata shapes
// ---------------------------------------------------------------------------

/** RFC 9728 §3 — Protected Resource Metadata document. */
export interface ProtectedResourceMetadata {
  /** The resource server's own URL (derived from the inbound request origin). */
  resource: string;
  /** List of Authorization Server issuer URLs that protect this resource. */
  authorization_servers: string[];
  /** Supported bearer token types. */
  bearer_methods_supported?: string[];
  /** Supported scopes. */
  scopes_supported?: string[];
  /** Supported signing algorithms for resource indications. */
  resource_signing_alg_values_supported?: string[];
  /** URL of the resource's documentation. */
  resource_documentation?: string;
  /** Human-readable name. */
  resource_name?: string;
}

/** RFC 8414 §2 — Authorization Server Metadata document. */
export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  jwks_uri?: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  response_types_supported?: string[];
  grant_types_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
  code_challenge_methods_supported?: string[];
  revocation_endpoint?: string;
  introspection_endpoint?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Platform context passed into createServer
// ---------------------------------------------------------------------------

export interface PlatformCtx {
  /** The original inbound request. */
  request: Request;
  /** Platform-specific environment bindings (Workers/Pages `env`, etc.). */
  env?: unknown;
  /** Cloudflare / edge `waitUntil` for background work. */
  waitUntil?: (promise: Promise<unknown>) => void;
}

// ---------------------------------------------------------------------------
// CORS configuration
// ---------------------------------------------------------------------------

export type CorsOriginFn = (req: Request) => string | null;

export interface CorsOptions {
  /**
   * Allowed origin(s). Accepts a static string, an array of strings,
   * or a function that returns the allowed origin (or null to omit the header).
   * Default: `"*"`.
   */
  origin?: string | string[] | CorsOriginFn;
  /** Whether to send `Access-Control-Allow-Credentials: true`. Default: false. */
  credentials?: boolean;
  /** Seconds for `Access-Control-Max-Age`. Default: 600. */
  maxAge?: number;
  /** Additional request headers to allow beyond the MCP defaults. */
  allowHeaders?: string[];
  /** Additional response headers to expose beyond the MCP defaults. */
  exposeHeaders?: string[];
}

// ---------------------------------------------------------------------------
// Observability hooks
// ---------------------------------------------------------------------------

export type McpRequestOutcome =
  | "ok"
  | "preflight"
  | "well-known"
  | "unauthorized"
  | "token-expired"
  | "method-not-allowed"
  | "not-found"
  | "error";

export interface McpRequestEvent {
  request: Request;
  outcome: McpRequestOutcome;
  /** HTTP status code of the response. */
  status: number;
  /** Duration in milliseconds. */
  durationMs: number;
  /** The error that caused an `"error"` outcome, if any. */
  error?: unknown;
}

// ---------------------------------------------------------------------------
// Handler configuration
// ---------------------------------------------------------------------------

export interface McpHttpHandlerConfig {
  /**
   * Base URL of the external OAuth Authorization Server (the issuer).
   * Used to populate `authorization_servers` in the protected-resource
   * metadata doc and optionally to proxy AS metadata.
   */
  authorizationServer: string;

  /**
   * Path the MCP endpoint listens on. Must start with `/`.
   * Default: `"/mcp"`.
   */
  mcpPath?: string;

  /**
   * Factory invoked per-request after Bearer extraction.
   * May be async. Receives the raw Bearer token string and platform context.
   */
  createServer: (bearerToken: string, ctx: PlatformCtx) => McpServer | Promise<McpServer>;

  /**
   * When provided, serves this document verbatim at
   * `GET /.well-known/oauth-authorization-server`.
   *
   * Takes precedence over `discoverAuthorizationServer`.
   */
  authorizationServerMetadata?: AuthorizationServerMetadata;

  /**
   * When `true`, mcp-http fetches the AS metadata document from
   * `{authorizationServer}/.well-known/oauth-authorization-server` on first
   * request and proxies it at the same well-known path.
   *
   * The result is cached on success. Failed fetches are not cached — the next
   * request will retry. Ignored when `authorizationServerMetadata` is set.
   *
   * Default: `false`.
   */
  discoverAuthorizationServer?: boolean;

  /**
   * Extra fields merged into the protected-resource metadata response.
   * `resource` and `authorization_servers` cannot be overridden.
   */
  protectedResourceMetadata?: Partial<
    Omit<ProtectedResourceMetadata, "resource" | "authorization_servers">
  >;

  /**
   * Reject tokens whose decoded `exp` claim is in the past (with a 30-second
   * clock-skew buffer) before touching the upstream API.
   *
   * This is a latency optimisation, **not a security control** — the upstream
   * API is still the authoritative validator.
   *
   * Set to `false` for opaque (non-JWT) tokens. Default: `true`.
   */
  earlyRejectExpiredTokens?: boolean;

  /**
   * CORS configuration. Set to `false` to disable CORS headers entirely.
   * Default: permissive (`"*"`) with all MCP-required headers.
   */
  cors?: false | CorsOptions;

  /**
   * Observability hook called once per request with the final outcome.
   * Errors thrown here are swallowed so they never affect the response.
   */
  onRequest?: (event: McpRequestEvent) => void | Promise<void>;

  /**
   * Error hook called when an unhandled exception occurs during transport.
   * Return a `Response` to override the default JSON-RPC 500 error body.
   * Default: `console.error`.
   */
  onError?: (
    err: unknown,
    req: Request,
  ) => Response | undefined | Promise<Response | undefined>;
}
