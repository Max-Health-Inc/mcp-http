import type { McpHttpHandlerConfig, PlatformCtx, McpRequestOutcome } from "./types.js";
import { applyCors, handlePreflight } from "./cors.js";
import { extractBearer, isJwtExpired } from "./jwt.js";
import { handleMcpPost } from "./transport.js";
import type { HandleMcpPostOptions } from "./transport.js";
import {
  PROTECTED_RESOURCE_PATH,
  AUTHORIZATION_SERVER_PATH,
  protectedResourceResponse,
  authorizationServerResponse,
} from "./well-known.js";
import { JSON_RPC_ERROR_CODES, toJsonRpcErrorResponse } from "./errors.js";

const DEFAULT_MCP_PATH = "/mcp";

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

/** Build a 401 response with the `WWW-Authenticate` resource-metadata pointer. */
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
      return respond(
        protectedResourceResponse(
          req.url,
          config.authorizationServer,
          config.protectedResourceMetadata,
        ),
        "well-known",
      );
    }

    // -----------------------------------------------------------------------
    // Well-known: authorization-server metadata (RFC 8414) — optional
    // -----------------------------------------------------------------------
    if (
      pathname === AUTHORIZATION_SERVER_PATH &&
      req.method === "GET" &&
      config.authorizationServerMetadata !== undefined
    ) {
      return respond(
        authorizationServerResponse(config.authorizationServerMetadata),
        "well-known",
      );
    }

    // -----------------------------------------------------------------------
    // MCP endpoint — non-POST methods → 405
    // -----------------------------------------------------------------------
    if (pathname === mcpPath && req.method !== "POST") {
      return respond(
        new Response(null, {
          status: 405,
          headers: { Allow: "POST, OPTIONS" },
        }),
        "method-not-allowed",
      );
    }

    // -----------------------------------------------------------------------
    // MCP endpoint — POST: auth gate → createServer → transport
    // -----------------------------------------------------------------------
    if (pathname === mcpPath && req.method === "POST") {
      const token = extractBearer(req.headers.get("Authorization"));

      if (token === null) {
        return respond(unauthorizedResponse(req), "unauthorized");
      }

      if (earlyReject && isJwtExpired(token)) {
        return respond(unauthorizedResponse(req), "token-expired");
      }

      const ctx: PlatformCtx = { request: req, ...platformCtx };

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
    return respond(new Response(null, { status: 404 }), "error");
  };
}
