/** Hono adapter. Mount on the top-level app, not a sub-router, so `/.well-known/*` resolves at the origin root (RFC 9728). */

import { Hono } from "hono";
import type { Context, Env } from "hono";
import { createMcpHttpHandler } from "../src/index.js";
import type { McpHttpHandlerConfig, PlatformCtx } from "../src/types.js";

/** Platform context passed to `createServer`, extended with the Hono `Context`. */
export interface HonoPlatformCtx<E extends Env = Env> extends PlatformCtx<E["Bindings"]> {
  c: Context<E>;
}

/** Handler config whose `createServer` receives a {@link HonoPlatformCtx}. */
export type McpHonoConfig<E extends Env = Env> = Omit<
  McpHttpHandlerConfig,
  "createServer"
> & {
  createServer: (
    bearerToken: string | null,
    ctx: HonoPlatformCtx<E>,
  ) => ReturnType<McpHttpHandlerConfig["createServer"]>;
};

/** Build a Hono app serving the MCP and well-known routes; mount with `app.route('/', ...)`. Built once so the AS-metadata cache survives. */
export function mcpHono<E extends Env = Env>(config: McpHonoConfig<E>): Hono<E> {
  const app = new Hono<E>();

  const handler = createMcpHttpHandler({
    ...config,
    // Sound by construction: the route below always supplies `c`.
    createServer: (token: string | null, ctx: PlatformCtx) =>
      config.createServer(token, ctx as HonoPlatformCtx<E>),
  });

  app.all("*", (c: Context<E>) => {
    const platformCtx: Omit<PlatformCtx<E["Bindings"]>, "request"> & {
      c: Context<E>;
    } = { env: c.env, c };
    return handler(c.req.raw, platformCtx);
  });

  return app;
}
