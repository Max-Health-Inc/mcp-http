/**
 * Hono adapter for @maxhealth.tech/mcp-http.
 *
 * Mount on the **top-level** Hono app (not a sub-router) so that the
 * /.well-known/* routes resolve at the origin root per RFC 9728.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono';
 * import { mcpHono } from '@maxhealth.tech/mcp-http/hono';
 * import { forwardBearer } from '@maxhealth.tech/mcp-http';
 *
 * const app = new Hono<{ Bindings: Env }>();
 *
 * app.route('/', mcpHono({
 *   authorizationServer: 'https://auth.example.com',
 *   createServer: (token, { c }) => buildMyMcpServer({
 *     fetchFn: forwardBearer(token),
 *     fhirUrl: c.env.FHIR_BASE_URL,
 *   }),
 * }));
 *
 * export default app;
 * ```
 */

import { Hono } from "hono";
import type { Context, Env } from "hono";
import { createMcpHttpHandler } from "../src/index.js";
import type { McpHttpHandlerConfig, PlatformCtx } from "../src/types.js";

/**
 * Extended platform context available inside `createServer` when using the
 * Hono adapter. Includes the full Hono `Context` for env bindings and helpers.
 */
export interface HonoPlatformCtx<E extends Env = Env> extends PlatformCtx {
  /** The Hono request context — provides access to `c.env`, `c.set`, etc. */
  c: Context<E>;
}

/**
 * Hono-specific handler config.
 *
 * `createServer` receives a {@link HonoPlatformCtx} which includes the raw
 * Hono `Context` (`c`). The generic parameter `E` allows consumers to type
 * `c.env` when using Cloudflare Workers bindings via `new Hono<E>()`.
 */
export type McpHonoConfig<E extends Env = Env> = Omit<
  McpHttpHandlerConfig,
  "createServer"
> & {
  createServer: (
    bearerToken: string | null,
    ctx: HonoPlatformCtx<E>,
  ) => ReturnType<McpHttpHandlerConfig["createServer"]>;
};

/**
 * Build a Hono sub-application that handles all MCP + well-known routes.
 *
 * The returned `Hono` instance should be mounted with `app.route('/', ...)`.
 *
 * A new core handler is created per-request so that the Hono `Context` (`c`)
 * can be closed over and surfaced to `createServer` without polluting the
 * runtime-agnostic core types.
 */
export function mcpHono<E extends Env = Env>(config: McpHonoConfig<E>): Hono<E> {
  const app = new Hono<E>();

  app.all("*", (c: Context<E>) => {
    // Build a single-use handler that captures `c` in its closure.
    const handler = createMcpHttpHandler({
      ...config,
      createServer: (token: string | null, ctx: PlatformCtx) =>
        config.createServer(token, { ...ctx, c }),
    });

    const platformCtx: Omit<PlatformCtx, "request"> = {
      env: c.env,
    };

    return handler(c.req.raw, platformCtx);
  });

  return app;
}
