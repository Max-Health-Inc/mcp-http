import { createMcpHandler, type McpServer } from "@modelcontextprotocol/server";
import { JSON_RPC_ERROR_CODES, toJsonRpcErrorResponse } from "./errors.js";

/**
 * Drive the MCP protocol for a single POST request.
 *
 * Protocol semantics belong to `createMcpHandler`: the 2026-07-28 revision,
 * `server/discover`, the `_meta` envelope, MRTR, and the inbound validation
 * ladder that emits `-32020` `HeaderMismatch`. This function owns only what
 * wraps them — the per-request server factory and the `onError` override.
 *
 * `legacy` is left at its default `'stateless'`, so 2025-era clients keep being
 * served (one fresh instance per request, no sessions) instead of being turned
 * away. GET and DELETE are answered `405` by the handler, matching the `Allow`
 * header the router already returns.
 */

export interface HandleMcpPostOptions {
  /** Per-request factory. Called once per serving unit, per era. */
  createServer: () => McpServer | Promise<McpServer>;
  req: Request;
  onError?: (
    err: unknown,
    req: Request,
  ) => Response | undefined | Promise<Response | undefined>;
}

export async function handleMcpPost(options: HandleMcpPostOptions): Promise<Response> {
  const { createServer, req, onError } = options;

  // Errors the SDK reports out-of-band (`onerror` is reporting-only and never
  // alters the response) are captured here so a failure that never throws can
  // still reach `onError` with a chance to override the reply. Held on an object
  // because a plain `let` assigned only inside the callback narrows to `null`.
  const reported: { err: Error | null } = { err: null };

  const handler = createMcpHandler(async () => createServer(), {
    onerror: (err: Error) => {
      reported.err ??= err;
    },
  });

  const fail = async (err: unknown): Promise<Response> => {
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
  };

  try {
    const res = await handler.fetch(req);

    // A reported error with a non-error status means the SDK answered normally
    // while something failed out-of-band; leave that response alone. Only give
    // `onError` the chance to override when the reply is itself a failure.
    if (reported.err !== null && res.status >= 500) {
      await handler.close();
      return await fail(reported.err);
    }

    // The body is still being written when `fetch` resolves, so closing now
    // would cut it. Defer until it drains or is cancelled.
    if (res.body instanceof ReadableStream) {
      const original = res.body as ReadableStream<Uint8Array>;
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      // A client disconnecting mid-response rejects the pipe, and `.finally()`
      // re-raises it. Left unhandled that fires on every cancelled request —
      // routine traffic, not an error — so swallow both it and any close error.
      void original
        .pipeTo(writable)
        .catch(() => undefined)
        .finally(() => {
          void handler.close().catch(() => undefined);
        });
      return new Response(readable, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    }

    await handler.close();
    return res;
  } catch (err: unknown) {
    await handler.close();
    return await fail(err);
  }
}
