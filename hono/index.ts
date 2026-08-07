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
export interface HonoPlatformCtx<E extends Env = Env> extends PlatformCtx<E["Bindings"]> {
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
 * Build a Hono sub-application handling all MCP + well-known routes. Mount with
 * `app.route('/', ...)`.
 *
 * The handler is built once: rebuilding it per request defeated the AS-metadata
 * cache, which lives in its closure.
 */
export function mcpHono<E extends Env = Env>(config: McpHonoConfig<E>): Hono<E> {
  const app = new Hono<E>();

  const handler = createMcpHttpHandler({
    ...config,
    // Sound by construction: the route below always supplies `c`.
    createServer: (token: string | null, ctx: PlatformCtx) =>
      config.createServer(token, ctx as HonoPlatformCtx<E>),
  });

  app.all("*", (c: Context<E>) => {
    // Typed on the variable so the extra `c` needs no assertion.
    const platformCtx: Omit<PlatformCtx<E["Bindings"]>, "request"> & {
      c: Context<E>;
    } = { env: c.env, c };
    return handler(c.req.raw, platformCtx);
  });

  return app;
}
