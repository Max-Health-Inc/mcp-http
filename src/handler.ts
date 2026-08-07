import { OAuthError, bearerAuthChallengeResponse } from "@modelcontextprotocol/server";
import type {
  McpHttpHandlerConfig,
  PlatformCtx,
  McpRequestOutcome,
  AuthorizationServerMetadata,
} from "./types.js";
import { applyCors, handlePreflight, isOriginAllowed } from "./cors.js";
import { extractBearer, isJwtExpired } from "./jwt.js";
import { handleMcpPost } from "./transport.js";
import type { HandleMcpPostOptions } from "./transport.js";
import {
  PROTECTED_RESOURCE_PATH,
  protectedResourcePath,
  AUTHORIZATION_SERVER_PATH,
  protectedResourceResponse,
  authorizationServerResponse,
} from "./well-known.js";
import { JSON_RPC_ERROR_CODES, toJsonRpcErrorResponse } from "./errors.js";
import { DEFAULT_MCP_PATH, allowedMethodsFor, allowMethodsValue } from "./routes.js";

/** How long a successfully discovered AS metadata document is cached (ms). */
const AS_METADATA_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Attach CORS headers to any `Response`, returning a new `Response` with those headers merged. */
function withCors(
  res: Response,
  req: Request,
  config: Pick<McpHttpHandlerConfig, "cors">,
): Response {
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
 * Build the 401 challenge, delegating the response shape to the SDK.
 *
 * Host-header trust: `req.url` derives the origin, so a spoofed `Host` behind a
 * proxy that does not normalise it yields an attacker-controlled pointer URL.
 */
function unauthorizedResponse(
  req: Request,
  prmPath: string,
  description: string,
): Response {
  const resourceMetadataUrl = `${new URL(req.url).origin}${prmPath}`;
  return bearerAuthChallengeResponse(new OAuthError("invalid_token", description), {
    resourceMetadataUrl,
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
export function buildHandler<Env = unknown>(
  config: McpHttpHandlerConfig<Env>,
): McpHandler {
  const mcpPath = config.mcpPath ?? DEFAULT_MCP_PATH;
  // RFC 9728 §3.1 path-aware metadata route derived from the mount point.
  const prmPath = protectedResourcePath(mcpPath);
  const earlyReject = config.earlyRejectExpiredTokens !== false;
  // Normalize: strip trailing slash so URLs like "https://auth.example.com/" don't
  // produce double slashes in discovery URLs or leak into authorization_servers.
  // null when authorizationServer is not configured (public endpoint).
  const authorizationServer = config.authorizationServer
    ? config.authorizationServer.replace(/\/+$/, "")
    : null;

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
      const preflight = handlePreflight(req, config.cors ?? {}, { mcpPath });
      if (preflight !== null) {
        return respond(preflight, "preflight");
      }
    }

    // -----------------------------------------------------------------------
    // Well-known: protected-resource metadata (RFC 9728)
    // -----------------------------------------------------------------------
    // Served at the RFC 9728 §3.1 path-aware route, and also at the bare
    // well-known path as a compatibility alias for clients that probe it.
    if (
      (pathname === prmPath || pathname === PROTECTED_RESOURCE_PATH) &&
      req.method === "GET"
    ) {
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
    // MCP endpoint — Origin gate (DNS-rebinding defence)
    // -----------------------------------------------------------------------
    // Refused outright rather than merely denied the CORS header: otherwise the
    // request still executes and only its response is unreadable.
    if (
      pathname === mcpPath &&
      config.cors !== false &&
      !isOriginAllowed(req, config.cors ?? {})
    ) {
      return respond(
        toJsonRpcErrorResponse(
          403,
          JSON_RPC_ERROR_CODES.INVALID_REQUEST,
          "Forbidden: the Origin header is not permitted by this server",
        ),
        "forbidden",
      );
    }

    // -----------------------------------------------------------------------
    // MCP endpoint — non-POST methods → 405
    // -----------------------------------------------------------------------
    if (pathname === mcpPath && req.method !== "POST") {
      // When CORS is enabled, OPTIONS is handled earlier (returns 204). If we
      // reach here with OPTIONS it means cors:false — don't advertise OPTIONS.
      const allowMethods = allowMethodsValue(
        allowedMethodsFor(pathname, mcpPath),
        config.cors !== false,
      );
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
          return respond(
            unauthorizedResponse(req, prmPath, "A Bearer token is required"),
            "unauthorized",
          );
        }

        if (earlyReject && isJwtExpired(token)) {
          return respond(
            unauthorizedResponse(req, prmPath, "The access token has expired"),
            "token-expired",
          );
        }
      }

      const ctx: PlatformCtx<Env> = { request: req, ...platformCtx } as PlatformCtx<Env>;

      // The factory is handed to the SDK rather than invoked here: it calls it
      // once per serving unit, per era. A throw from it surfaces through
      // `handleMcpPost`, which routes it to `onError` like any other failure.
      const mcpOpts: HandleMcpPostOptions = {
        createServer: () => config.createServer(token, ctx),
        req,
      };
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
