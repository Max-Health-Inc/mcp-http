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

  const contexts = new WeakMap<Request, Context<E>>();
  const handler = createMcpHttpHandler<E["Bindings"]>({
    ...config,
    createServer: (token: string | null, ctx: PlatformCtx<E["Bindings"]>) => {
      const c = contexts.get(ctx.request);
      if (c === undefined) throw new Error("[mcp-http] no Hono context for this request");
      return config.createServer(token, { ...ctx, c });
    },
  });

  app.all("*", (c: Context<E>) => {
    contexts.set(c.req.raw, c);
    return handler(c.req.raw, { env: c.env });
  });

  return app;
}
