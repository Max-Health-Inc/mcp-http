import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { JSON_RPC_ERROR_CODES, toJsonRpcErrorResponse } from "./errors.js";
import type { SessionStore } from "./session-store.js";

/**
 * MCP `Accept` header values for the Streamable HTTP transport.
 * Clients that only speak SSE (older Claude Desktop) send `text/event-stream`
 * without `application/json`. We normalise the header so the transport always
 * sees both and can pick the right response format.
 */
const MCP_ACCEPT = "application/json, text/event-stream";

/** Header name the SDK uses to track sessions. */
const SESSION_ID_HEADER = "mcp-session-id";

/**
 * Ensure the `Accept` header contains both content types required by the MCP
 * Streamable HTTP transport spec. Mutates the provided `Headers` clone.
 */
function normalizeAcceptHeader(headers: Headers): Headers {
  const accept = headers.get("Accept") ?? "";
  const hasJson = accept.includes("application/json");
  const hasSse = accept.includes("text/event-stream");

  if (!hasJson || !hasSse) {
    headers.set("Accept", MCP_ACCEPT);
  }
  return headers;
}

/**
 * Clone a `Request` with the `Accept` header normalised for MCP.
 * We must clone because `Request` headers are immutable.
 */
function withNormalizedAccept(req: Request): Request {
  const headers = new Headers(req.headers);
  normalizeAcceptHeader(headers);
  return new Request(req, { headers });
}

export interface HandleMcpPostOptions {
  server: McpServer;
  req: Request;
  onError?: (
    err: unknown,
    req: Request,
  ) => Response | undefined | Promise<Response | undefined>;
}

/**
 * Drive the full MCP transport lifecycle for a single POST request (STATELESS).
 *
 * 1. Instantiate a stateless `WebStandardStreamableHTTPServerTransport`
 * 2. Connect the `McpServer` to it
 * 3. Delegate to `transport.handleRequest(req)`
 * 4. Close the server when the response body has been fully consumed
 *    (deferred for SSE streams; immediate for JSON responses)
 *
 * Returns the `Response` produced by the transport. On unhandled errors
 * the `onError` hook is called; if it returns a `Response` that is used,
 * otherwise a JSON-RPC 500 body is returned.
 *
 * NOTE: This mode does NOT support server-initiated RPC like `createMessage`.
 * Use `handleMcpPostStateful` for sampling/createMessage support.
 */
export async function handleMcpPost(options: HandleMcpPostOptions): Promise<Response> {
  const { server, req, onError } = options;

  // Stateless mode: omit sessionIdGenerator entirely (passing `undefined`
  // explicitly is rejected by exactOptionalPropertyTypes).
  const transport = new WebStandardStreamableHTTPServerTransport();

  try {
    await server.connect(transport);
    const normalizedReq = withNormalizedAccept(req);
    const res = await transport.handleRequest(normalizedReq);

    // SSE responses have a live ReadableStream body — the SDK writes
    // responses asynchronously via transport.send(). Calling server.close()
    // immediately would kill the stream before the client receives data.
    // Defer cleanup until the stream completes or is cancelled.
    if (res.body instanceof ReadableStream) {
      const original = res.body as ReadableStream<Uint8Array>;
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      void original.pipeTo(writable).finally(() => void server.close());
      return new Response(readable, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    }

    // Non-streaming (JSON) responses are complete — safe to close now.
    await server.close();
    return res;
  } catch (err: unknown) {
    await server.close();
    if (onError) {
      try {
        const override = await onError(err, req);
        if (override instanceof Response) return override;
      } catch {
        // Swallow errors from the error hook itself
      }
    } else {
      console.error("[mcp-http] Unhandled transport error", err);
    }

    return toJsonRpcErrorResponse(
      500,
      JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
      "Internal server error",
    );
  }
}

// ---------------------------------------------------------------------------
// Stateful (session-based) transport — supports server→client RPC
// ---------------------------------------------------------------------------

export interface HandleMcpStatefulOptions {
  /** Factory to create a new McpServer instance for a new session. */
  createServer: () => McpServer | Promise<McpServer>;
  /** The inbound request. */
  req: Request;
  /** Session store (shared across requests). */
  sessionStore: SessionStore;
  /** Error handler. */
  onError?: (
    err: unknown,
    req: Request,
  ) => Response | undefined | Promise<Response | undefined>;
}

/**
 * Handle an MCP POST request with session support.
 *
 * - If the request carries a `Mcp-Session-Id` header, route to the existing
 *   session's transport.
 * - If this is an `initialize` request (no session ID), create a new session
 *   with a fresh transport + server, register it in the store.
 *
 * This enables server-initiated RPC (sampling/createMessage) because the
 * transport persists across requests.
 */
export async function handleMcpPostStateful(
  options: HandleMcpStatefulOptions,
): Promise<Response> {
  const { createServer, req, sessionStore, onError } = options;
  const sessionId = req.headers.get(SESSION_ID_HEADER);

  try {
    // ── Existing session: route to stored transport ──────────────────────
    if (sessionId) {
      const entry = sessionStore.get(sessionId);
      if (!entry) {
        // Session expired or unknown — client must re-initialize
        return new Response(JSON.stringify({ error: "Session not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      const normalizedReq = withNormalizedAccept(req);
      return await entry.transport.handleRequest(normalizedReq);
    }

    // ── New session: create transport + server ───────────────────────────
    const server = await createServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (id: string) => {
        sessionStore.set(id, {
          transport,
          server,
          createdAt: Date.now(),
          lastAccessedAt: Date.now(),
        });
      },
    });

    await server.connect(transport);
    const normalizedReq = withNormalizedAccept(req);
    return await transport.handleRequest(normalizedReq);
  } catch (err: unknown) {
    if (onError) {
      try {
        const override = await onError(err, req);
        if (override instanceof Response) return override;
      } catch {
        // Swallow hook errors
      }
    } else {
      console.error("[mcp-http] Unhandled stateful transport error", err);
    }

    return toJsonRpcErrorResponse(
      500,
      JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
      "Internal server error",
    );
  }
}
