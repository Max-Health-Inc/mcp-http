import type {
  McpHttpHandlerConfig,
  PlatformCtx,
  McpRequestOutcome,
  AuthorizationServerMetadata,
} from "./types.js";
import { applyCors, handlePreflight } from "./cors.js";
import { extractBearer, isJwtExpired } from "./jwt.js";
import { handleMcpPost, handleMcpPostStateful } from "./transport.js";
import type { HandleMcpPostOptions } from "./transport.js";
import {
  PROTECTED_RESOURCE_PATH,
  AUTHORIZATION_SERVER_PATH,
  protectedResourceResponse,
  authorizationServerResponse,
} from "./well-known.js";
import { JSON_RPC_ERROR_CODES, toJsonRpcErrorResponse } from "./errors.js";
import { SessionStore } from "./session-store.js";

const DEFAULT_MCP_PATH = "/mcp";

/** How long a successfully discovered AS metadata document is cached (ms). */
const AS_METADATA_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Attach CORS headers to any `Response`, returning a new `Response` with those headers merged. */
function withCors(res: Response, req: Request, config: McpHttpHandlerConfig): Response {
  if (config.cors === false) return res;

  const headers = new Headers(res.headers);
  applyCors(headers, req, config.cors ?? {});
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

/**
 * Build a 401 response with the `WWW-Authenticate` resource-metadata pointer.
 *
 * **Note — Host-header trust:** `req.url` is used to derive the origin, so
 * the accuracy of the pointer depends on the runtime correctly normalising
 * the request URL. On Cloudflare Workers this is always the worker's own
 * domain. On Node / Bun / Deno served directly (without a reverse proxy that
 * sets a canonical `Host`), a client could supply a spoofed `Host` header and
 * receive a `WWW-Authenticate` URL pointing to an attacker-controlled host.
 * Mitigate by running behind a reverse proxy that enforces the `Host` header,
 * or by configuring a `publicOrigin` at the edge/platform level.
 */
function unauthorizedResponse(req: Request): Response {
  const origin = new URL(req.url).origin;
  const resourceMetadataUrl = `${origin}${PROTECTED_RESOURCE_PATH}`;

  return new Response(null, {
    status: 401,
    headers: {
      "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl}"`,
    },
  });
}

export type McpHandler = (
  req: Request,
  platformCtx?: Omit<PlatformCtx, "request">,
) => Promise<Response>;

/**
 * Build the core request handler from a validated config.
 *
 * The returned function maps a Web Fetch `Request` → `Promise<Response>`.
 * All routing, auth gating, well-known doc serving, CORS, and transport
 * lifecycle are encapsulated here.
 */
export function buildHandler(config: McpHttpHandlerConfig): McpHandler {
  const mcpPath = config.mcpPath ?? DEFAULT_MCP_PATH;
  const earlyReject = config.earlyRejectExpiredTokens !== false;
  const stateful = config.stateful === true;
  // Normalize: strip trailing slash so URLs like "https://auth.example.com/" don't
  // produce double slashes in discovery URLs or leak into authorization_servers.
  // null when authorizationServer is not configured (public endpoint).
  const authorizationServer = config.authorizationServer
    ? config.authorizationServer.replace(/\/+$/, "")
    : null;

  // Session store for stateful mode (shared across all requests)
  const sessionStore = stateful ? new SessionStore({ ttlMs: config.sessionTtlMs }) : null;

  // ------------------------------------------------------------------
  // Authorization Server metadata — static or auto-discovered
  // ------------------------------------------------------------------
  let discoveredMetadata: AuthorizationServerMetadata | null = null;
  let discoveredAt: number | null = null;
  let discoveryInFlight: Promise<AuthorizationServerMetadata | null> | null = null;

  async function resolveAsMetadata(): Promise<AuthorizationServerMetadata | null> {
    // resolveAsMetadata is only called after an authorizationServer null-check in the
    // request handler, but TypeScript can't narrow the closed-over variable through
    // the function boundary. Guard here so the template literal below stays typed
    // as `string` and satisfies the no-null-in-template lint rule.
    const as = authorizationServer;
    if (as === null) return null;

    // Return cached value if still within TTL.
    if (discoveredMetadata !== null && discoveredAt !== null) {
      if (Date.now() - discoveredAt < AS_METADATA_TTL_MS) return discoveredMetadata;
      // TTL expired — clear so the next request re-fetches.
      discoveredMetadata = null;
      discoveredAt = null;
    }

    // Coalesce concurrent requests onto a single in-flight fetch.
    if (discoveryInFlight !== null) return discoveryInFlight;

    const url = `${as}/.well-known/oauth-authorization-server`;
    discoveryInFlight = globalThis
      .fetch(url)
      .then(async (r) => {
        if (!r.ok) return null;
        return (await r.json()) as AuthorizationServerMetadata;
      })
      .catch(() => null)
      .then((result) => {
        discoveryInFlight = null; // allow retry on failure
        if (result !== null) {
          discoveredMetadata = result;
          discoveredAt = Date.now();
        }
        return result;
      });

    return discoveryInFlight;
  }

  return async (
    req: Request,
    platformCtx?: Omit<PlatformCtx, "request">,
  ): Promise<Response> => {
    const start = Date.now();
    let outcome: McpRequestOutcome = "ok";

    const respond = async (
      resPromise: Response | Promise<Response>,
      o: McpRequestOutcome,
    ): Promise<Response> => {
      outcome = o;
      const res = await resPromise;
      const finalRes = withCors(res, req, config);

      if (config.onRequest) {
        try {
          await config.onRequest({
            request: req,
            outcome,
            status: finalRes.status,
            durationMs: Date.now() - start,
          });
        } catch {
          // Swallow — observability hooks must never affect the response
        }
      }

      return finalRes;
    };

    const { pathname } = new URL(req.url);

    // -----------------------------------------------------------------------
    // OPTIONS preflight
    // -----------------------------------------------------------------------
    if (req.method === "OPTIONS") {
      const preflight = handlePreflight(req, config.cors ?? {});
      if (preflight !== null) {
        return respond(preflight, "preflight");
      }
    }

    // -----------------------------------------------------------------------
    // Well-known: protected-resource metadata (RFC 9728)
    // -----------------------------------------------------------------------
    if (pathname === PROTECTED_RESOURCE_PATH && req.method === "GET") {
      if (authorizationServer === null) {
        return respond(new Response(null, { status: 404 }), "not-found");
      }
      const origin = new URL(req.url).origin;
      const resourceUrl = `${origin}${mcpPath}`;
      return respond(
        protectedResourceResponse(
          resourceUrl,
          authorizationServer,
          config.protectedResourceMetadata,
        ),
        "well-known",
      );
    }

    // -----------------------------------------------------------------------
    // Well-known: authorization-server metadata (RFC 8414) — static or discovered
    // -----------------------------------------------------------------------
    if (pathname === AUTHORIZATION_SERVER_PATH && req.method === "GET") {
      if (authorizationServer === null) {
        return respond(new Response(null, { status: 404 }), "not-found");
      }
      if (config.authorizationServerMetadata !== undefined) {
        return respond(
          authorizationServerResponse(config.authorizationServerMetadata),
          "well-known",
        );
      }
      if (config.discoverAuthorizationServer) {
        const asMetadata = await resolveAsMetadata();
        if (asMetadata === null) {
          return respond(
            new Response(JSON.stringify({ error: "AS metadata unavailable" }), {
              status: 502,
              headers: { "Content-Type": "application/json" },
            }),
            "well-known",
          );
        }
        return respond(authorizationServerResponse(asMetadata), "well-known");
      }
      return respond(new Response(null, { status: 404 }), "well-known");
    }

    // -----------------------------------------------------------------------
    // MCP endpoint — non-POST methods → 405
    // -----------------------------------------------------------------------
    if (pathname === mcpPath && req.method !== "POST") {
      // When CORS is enabled, OPTIONS is handled earlier (returns 204). If we
      // reach here with OPTIONS it means cors:false — don't advertise OPTIONS.
      const allowMethods = config.cors !== false ? "POST, OPTIONS" : "POST";
      return respond(
        new Response(null, {
          status: 405,
          headers: { Allow: allowMethods },
        }),
        "method-not-allowed",
      );
    }

    // -----------------------------------------------------------------------
    // MCP endpoint — POST: auth gate → createServer → transport
    // -----------------------------------------------------------------------
    if (pathname === mcpPath && req.method === "POST") {
      let token: string | null = null;

      if (authorizationServer !== null) {
        token = extractBearer(req.headers.get("Authorization"));

        if (token === null) {
          return respond(unauthorizedResponse(req), "unauthorized");
        }

        if (earlyReject && isJwtExpired(token)) {
          return respond(unauthorizedResponse(req), "token-expired");
        }
      }

      const ctx: PlatformCtx = { request: req, ...platformCtx };

      // ── Stateful mode: use session store for persistent transports ──
      if (stateful && sessionStore) {
        const statefulOpts: Parameters<typeof handleMcpPostStateful>[0] = {
          createServer: () => config.createServer(token, ctx),
          req,
          sessionStore,
        };
        if (config.onError !== undefined) {
          statefulOpts.onError = config.onError;
        }
        return respond(handleMcpPostStateful(statefulOpts), "ok");
      }

      // ── Stateless mode (default): one-shot transport per request ──
      let server;
      try {
        server = await config.createServer(token, ctx);
      } catch (err: unknown) {
        if (config.onError) {
          try {
            const override = await config.onError(err, req);
            if (override instanceof Response) {
              return await respond(override, "error");
            }
          } catch {
            // Swallow hook errors
          }
        }
        return respond(
          toJsonRpcErrorResponse(
            500,
            JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
            "Failed to initialise MCP server",
          ),
          "error",
        );
      }

      const mcpOpts: HandleMcpPostOptions = { server, req };
      if (config.onError !== undefined) {
        mcpOpts.onError = config.onError;
      }
      return respond(handleMcpPost(mcpOpts), "ok");
    }

    // -----------------------------------------------------------------------
    // No route matched — 404
    // -----------------------------------------------------------------------
    return respond(new Response(null, { status: 404 }), "not-found");
  };
}
