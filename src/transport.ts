import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { JSON_RPC_ERROR_CODES, toJsonRpcErrorResponse } from "./errors.js";

/**
 * MCP `Accept` header values for the Streamable HTTP transport.
 * Clients that only speak SSE (older Claude Desktop) send `text/event-stream`
 * without `application/json`. We normalise the header so the transport always
 * sees both and can pick the right response format.
 */
const MCP_ACCEPT = "application/json, text/event-stream";

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
 * Drive the full MCP transport lifecycle for a single POST request:
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
