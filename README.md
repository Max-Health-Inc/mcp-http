# @maxhealth.tech/mcp-http

Framework-agnostic [MCP](https://modelcontextprotocol.io/) HTTP transport with [RFC 9728](https://datatracker.ietf.org/doc/html/rfc9728) OAuth resource-server plumbing.

Built on the **Web Fetch API** — runs on Cloudflare Workers, Pages Functions, Deno Deploy, Bun, Node 18+, and any Hono deployment.

## Features

- **Stateless MCP transport** — one `WebStandardStreamableHTTPServerTransport` per POST, no session state required
- **RFC 9728** `/.well-known/oauth-protected-resource` served automatically
- **RFC 8414** `/.well-known/oauth-authorization-server` (optional)
- **Bearer extraction + 401 gate** with `WWW-Authenticate` resource-metadata pointer
- **JWT `exp` early-rejection** (configurable, 30 s clock-skew buffer)
- **CORS** — permissive defaults (`*`), fully configurable per-origin, or disabled
- **`forwardBearer(token)`** — inject the caller's token into upstream `fetch` calls
- **Observability** — `onRequest` hook with outcome, status, and duration
- **Error handling** — `onError` hook with JSON-RPC 500 fallback
- **Adapters** — first-class Hono and Cloudflare Pages Functions adapters

## Install

```bash
# bun
bun add @maxhealth.tech/mcp-http @modelcontextprotocol/sdk

# npm
npm install @maxhealth.tech/mcp-http @modelcontextprotocol/sdk

# pnpm
pnpm add @maxhealth.tech/mcp-http @modelcontextprotocol/sdk
```

`@modelcontextprotocol/sdk` is a **peer dependency** (≥ 1.29.0).
`hono` is an **optional peer dependency** (≥ 4.12.0) — only needed for the `/hono` adapter.

## Quick start

### Cloudflare Workers

```ts
import { createWorkerFetch, forwardBearer } from "@maxhealth.tech/mcp-http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export default {
  fetch: createWorkerFetch({
    authorizationServer: "https://auth.example.com",
    createServer: (token) => {
      const server = new McpServer({ name: "my-api", version: "1.0.0" });
      // Register tools, resources, prompts…
      // Use forwardBearer(token) to call upstream APIs with the caller's token
      return server;
    },
  }),
};
```

### Hono

```ts
import { Hono } from "hono";
import { mcpHono } from "@maxhealth.tech/mcp-http/hono";
import { forwardBearer } from "@maxhealth.tech/mcp-http";

const app = new Hono<{ Bindings: Env }>();

app.route(
  "/",
  mcpHono({
    authorizationServer: "https://auth.example.com",
    createServer: (token, { c }) => {
      const server = new McpServer({ name: "my-api", version: "1.0.0" });
      const fetchFn = forwardBearer(token);
      const fhirUrl = c.env.FHIR_BASE_URL;
      // Register tools using fetchFn and fhirUrl…
      return server;
    },
  }),
);

export default app;
```

### Cloudflare Pages Functions

```ts
// functions/[[path]].ts
import { mcpPagesFunction } from "@maxhealth.tech/mcp-http/cloudflare";
import { forwardBearer } from "@maxhealth.tech/mcp-http";

export const onRequest = mcpPagesFunction({
  authorizationServer: "https://auth.example.com",
  createServer: (token, { env }) => {
    const server = new McpServer({ name: "my-api", version: "1.0.0" });
    // Use forwardBearer(token) for upstream calls
    return server;
  },
});
```

### Generic (any runtime)

```ts
import { createMcpHttpHandler } from "@maxhealth.tech/mcp-http";

const handler = createMcpHttpHandler({
  authorizationServer: "https://auth.example.com",
  createServer: (token) => buildMyMcpServer(token),
});

// Use with any runtime that supports Request → Response
Bun.serve({ fetch: handler });
Deno.serve(handler);
```

## Configuration

`createMcpHttpHandler(config)` accepts a `McpHttpHandlerConfig` object:

| Option                        | Type                                 | Default           | Description                                                                                                                                                                       |
| ----------------------------- | ------------------------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authorizationServer`         | `string`                             | **(required)**    | OAuth Authorization Server URL (issuer). Trailing slash is stripped automatically. Populates `authorization_servers` in the protected-resource metadata.                          |
| `createServer`                | `(token, ctx) => McpServer`          | **(required)**    | Factory called per-request after Bearer extraction. Receives the raw token and a `PlatformCtx`. May be async.                                                                     |
| `mcpPath`                     | `string`                             | `"/mcp"`          | Path the MCP endpoint listens on. Must start with `/`. Also used as the `resource` path in the RFC 9728 metadata.                                                                 |
| `earlyRejectExpiredTokens`    | `boolean`                            | `true`            | Reject JWTs with expired `exp` before hitting upstream. Set `false` for opaque tokens.                                                                                            |
| `cors`                        | `CorsOptions \| false`               | `{ origin: "*" }` | CORS configuration. Set `false` to disable.                                                                                                                                       |
| `authorizationServerMetadata` | `AuthorizationServerMetadata`        | —                 | If provided, serves at `GET /.well-known/oauth-authorization-server`. Takes precedence over `discoverAuthorizationServer`.                                                        |
| `discoverAuthorizationServer` | `boolean`                            | `false`           | When `true`, fetches and proxies the AS metadata from `{authorizationServer}/.well-known/oauth-authorization-server`. Result is cached; failures are retried on the next request. |
| `protectedResourceMetadata`   | `Partial<ProtectedResourceMetadata>` | —                 | Extra fields merged into the protected-resource metadata (`resource` and `authorization_servers` cannot be overridden).                                                           |
| `onRequest`                   | `(event) => void`                    | —                 | Observability hook called once per request with outcome, status, and duration.                                                                                                    |
| `onError`                     | `(err, req) => Response?`            | —                 | Error hook. Return a `Response` to override the default JSON-RPC 500.                                                                                                             |

### CORS options

```ts
createMcpHttpHandler({
  // …
  cors: {
    origin: ["https://app.example.com", "https://admin.example.com"],
    credentials: true,
    maxAge: 3600,
    allowHeaders: ["X-Custom-Header"],
    exposeHeaders: ["X-Request-Id"],
  },
});
```

The default CORS config allows `*` origins and exposes the MCP-required headers (`Content-Type`, `Authorization`, `Mcp-Session-Id`, `Last-Event-ID`).

## Exports

The package exposes three entry points:

| Import path                           | Contents                                       |
| ------------------------------------- | ---------------------------------------------- |
| `@maxhealth.tech/mcp-http`            | Core handler, types, and à la carte primitives |
| `@maxhealth.tech/mcp-http/hono`       | `mcpHono()` adapter                            |
| `@maxhealth.tech/mcp-http/cloudflare` | `mcpPagesFunction()` adapter                   |

### À la carte primitives

For advanced use cases, individual building blocks are re-exported from the main entry point:

```ts
import {
  // JWT utilities
  extractBearer, // (header: string | null) => string | null
  isJwtExpired, // (token: string) => boolean

  // Upstream fetch helper
  forwardBearer, // (token: string) => FetchFn

  // CORS
  applyCors, // (headers: Headers, req: Request, options: CorsOptions) => void
  handlePreflight, // (req: Request, corsConfig: CorsOptions | false) => Response | null

  // Well-known metadata
  buildProtectedResourceMetadata,
  buildAuthorizationServerMetadata,
  protectedResourceResponse,
  authorizationServerResponse,
  PROTECTED_RESOURCE_PATH, // "/.well-known/oauth-protected-resource"
  AUTHORIZATION_SERVER_PATH, // "/.well-known/oauth-authorization-server"

  // Transport
  handleMcpPost, // (options: HandleMcpPostOptions) => Promise<Response>

  // JSON-RPC errors
  toJsonRpcErrorBody,
  toJsonRpcErrorResponse,
  JSON_RPC_ERROR_CODES,
} from "@maxhealth.tech/mcp-http";
```

## Request lifecycle

```
Request
  │
  ├─ OPTIONS  →  CORS preflight 204
  │
  ├─ GET /.well-known/oauth-protected-resource  →  RFC 9728 metadata (resource = origin+mcpPath)
  ├─ GET /.well-known/oauth-authorization-server →  RFC 8414 metadata (static, discovered, or 404)
  │
  ├─ POST /mcp
  │   ├─ No Bearer token?  →  401 + WWW-Authenticate
  │   ├─ JWT expired?      →  401 (if earlyRejectExpiredTokens)
  │   └─ Valid token       →  createServer() → MCP transport → Response
  │
  └─ anything else  →  404
```

All responses pass through the CORS middleware and the `onRequest` observability hook.

## Development

```bash
bun install
bun run typecheck    # tsc --noEmit
bun run lint         # eslint .
bun run format:check # prettier --check .
bun test             # 121 tests
bun run check        # typecheck + lint + format + test with coverage + build
```

## License

MIT
