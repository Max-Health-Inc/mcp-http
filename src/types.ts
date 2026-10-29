import type { McpServer } from "@modelcontextprotocol/server";

/** RFC 9728 §3 — Protected Resource Metadata document. */
export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported?: string[];
  scopes_supported?: string[];
  resource_signing_alg_values_supported?: string[];
  resource_documentation?: string;
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

/** Platform context passed into `createServer`. */
export interface PlatformCtx<Env = unknown> {
  request: Request;
  env?: Env;
  waitUntil?: (promise: Promise<unknown>) => void;
}

export type CorsOriginFn = (req: Request) => string | null;

export interface CorsOptions {
  /** Allowed origin(s); a function may return null to omit the header. Default: `"*"`. */
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

export type McpRequestOutcome =
  | "ok"
  | "preflight"
  | "well-known"
  | "unauthorized"
  | "forbidden"
  | "token-expired"
  | "method-not-allowed"
  | "not-found"
  | "error";

export interface McpRequestEvent {
  request: Request;
  outcome: McpRequestOutcome;
  status: number;
  durationMs: number;
  /** The error that caused an `"error"` outcome, if any. */
  error?: unknown;
}

export interface McpHttpHandlerConfig<Env = unknown> {
  /**
   * Issuer base URL of the external OAuth Authorization Server.
   * Omit for public endpoints: no Bearer gate, `createServer` gets `null`, well-known routes 404.
   */
  authorizationServer?: string;

  /** Path the MCP endpoint listens on; must start with `/`. Default: `"/mcp"`. */
  mcpPath?: string;

  /** Per-request server factory; receives the raw Bearer token, or `null` without `authorizationServer`. */
  createServer: (
    bearerToken: string | null,
    ctx: PlatformCtx<Env>,
  ) => McpServer | Promise<McpServer>;

  /** Served verbatim at `/.well-known/oauth-authorization-server`; wins over `discoverAuthorizationServer`. */
  authorizationServerMetadata?: AuthorizationServerMetadata;

  /** Fetch and proxy the AS metadata document on first request; successes are cached, failures retried. Default: `false`. */
  discoverAuthorizationServer?: boolean;

  /** Extra fields merged into the protected-resource metadata; `resource` and `authorization_servers` cannot be overridden. */
  protectedResourceMetadata?: Partial<
    Omit<ProtectedResourceMetadata, "resource" | "authorization_servers">
  >;

  /**
   * Reject JWTs past `exp` (30 s skew) before the upstream call. A latency optimisation, not a security control.
   * Set to `false` for opaque tokens. Default: `true`.
   */
  earlyRejectExpiredTokens?: boolean;

  /** CORS configuration, or `false` to disable. Default: `"*"` with all MCP headers. */
  cors?: false | CorsOptions;

  /** Called once per request with the outcome; errors thrown here are swallowed. */
  onRequest?: (event: McpRequestEvent) => void | Promise<void>;

  /** Called on an unhandled transport error; return a `Response` to replace the JSON-RPC 500. Default: `console.error`. */
  onError?: (
    err: unknown,
    req: Request,
  ) => Response | undefined | Promise<Response | undefined>;
}
