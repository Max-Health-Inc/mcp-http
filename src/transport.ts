import { createMcpHandler, type McpServer } from "@modelcontextprotocol/server";
import { JSON_RPC_ERROR_CODES, toJsonRpcErrorResponse } from "./errors.js";

/**
 * Drive the MCP protocol for a single POST request.
 *
 * Protocol semantics belong to `createMcpHandler`; this owns the server factory
 * and the `onError` override. `legacy` stays at `'stateless'` so 2025-era
 * clients are still served.
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

  // Captured so an out-of-band failure can still reach `onError`. On an object
  // because a `let` assigned only in the callback narrows to `null`.
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

    // Only override when the reply is itself a failure.
    if (reported.err !== null && res.status >= 500) {
      await handler.close();
      return await fail(reported.err);
    }

    // Still being written when `fetch` resolves; close once it drains.
    if (res.body instanceof ReadableStream) {
      const original = res.body as ReadableStream<Uint8Array>;
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      // A disconnect rejects the pipe and `.finally()` re-raises it; swallow both.
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
