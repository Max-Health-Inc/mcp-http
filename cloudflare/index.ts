/**
 * Cloudflare Pages Functions adapter for @maxhealth.tech/mcp-http.
 *
 * Use a **catch-all** Pages Function (`functions/[[path]].ts`) so that both
 * `/mcp` and `/.well-known/*` resolve through this handler and the RFC 9728
 * well-known documents are reachable at the origin root.
 *
 * @example
 * ```ts
 * // functions/[[path]].ts
 * import { mcpPagesFunction } from '@maxhealth.tech/mcp-http/cloudflare';
 * import { forwardBearer } from '@maxhealth.tech/mcp-http';
 *
 * export const onRequest = mcpPagesFunction({
 *   authorizationServer: 'https://auth.example.com',
 *   createServer: (token, { env }) => buildMyMcpServer({
 *     fetchFn: forwardBearer(token),
 *     fhirUrl: (env as Env).FHIR_BASE_URL,
 *   }),
 * });
 * ```
 */

import { createMcpHttpHandler } from "../src/index.js";
import type { McpHttpHandlerConfig } from "../src/types.js";

/**
 * Minimal interface for the Cloudflare Pages `EventContext` object.
 *
 * Typed loosely so this adapter doesn't pull in `@cloudflare/workers-types`
 * as a hard dependency (consumers supply their own env types).
 */
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

/**
 * Wrap a handler config into a Cloudflare Pages Function `onRequest` export.
 *
 * The adapter unwraps the Pages `EventContext` and forwards:
 * - `request` → the raw `Request`
 * - `env` → the Pages `env` bindings object
 * - `waitUntil` → the Pages `waitUntil` helper
 *
 * The generic `Env` parameter lets consumers type `env` without importing
 * Cloudflare-specific types in their app code.
 */
export function mcpPagesFunction<Env = unknown>(
  config: McpHttpHandlerConfig,
): PagesOnRequestHandler<Env> {
  const handler = createMcpHttpHandler(config);

  return (context: PagesFunctionEventContext<Env>): Promise<Response> => {
    return handler(context.request, {
      env: context.env as unknown,
      waitUntil: context.waitUntil.bind(context),
    });
  };
}
