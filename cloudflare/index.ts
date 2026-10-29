/** Cloudflare Pages adapter. Mount as a catch-all `functions/[[path]].ts` so `/.well-known/*` resolves at the origin root (RFC 9728). */

import { createMcpHttpHandler } from "../src/index.js";
import type { McpHttpHandlerConfig } from "../src/types.js";

/** Minimal Pages `EventContext`, so `@cloudflare/workers-types` stays out of the dependency tree. */
export interface PagesFunctionEventContext<Env = unknown> {
  request: Request;
  env: Env;
  params: Record<string, string | string[]>;
  waitUntil: (promise: Promise<unknown>) => void;
  passThroughOnException: () => void;
  next: (input?: Request | string, init?: RequestInit) => Promise<Response>;
  data: Record<string, unknown>;
}

export type PagesOnRequestHandler<Env = unknown> = (
  context: PagesFunctionEventContext<Env>,
) => Response | Promise<Response>;

/** Wrap a handler config into a Cloudflare Pages Function `onRequest` export. */
export function mcpPagesFunction<Env = unknown>(
  config: McpHttpHandlerConfig<Env>,
): PagesOnRequestHandler<Env> {
  const handler = createMcpHttpHandler(config);

  return (context: PagesFunctionEventContext<Env>): Promise<Response> => {
    return handler(context.request, {
      env: context.env,
      waitUntil: context.waitUntil.bind(context),
    });
  };
}
