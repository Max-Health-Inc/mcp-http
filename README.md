# @maxhealth.tech/mcp-http

OAuth, CORS and observability layer for [MCP](https://modelcontextprotocol.io/) HTTP servers, built on the official [`@modelcontextprotocol/server`](https://www.npmjs.com/package/@modelcontextprotocol/server) SDK.

Built on the **Web Fetch API** — runs on Cloudflare Workers, Pages Functions, Deno Deploy, Bun, Node 18+, and any Hono deployment.

## Features

- **Stateless MCP transport** — one `WebStandardStreamableHTTPServerTransport` per POST, no session state required
- **RFC 9728** protected-resource metadata served automatically, at the path-aware route (`/.well-known/oauth-protected-resource/mcp` for an endpoint mounted at `/mcp`)
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
bun add @maxhealth.tech/mcp-http @modelcontextprotocol/server

# npm
npm install @maxhealth.tech/mcp-http @modelcontextprotocol/server

# pnpm
pnpm add @maxhealth.tech/mcp-http @modelcontextprotocol/server
```

`@modelcontextprotocol/server` is a **peer dependency** (^2.0.0).
`hono` is an **optional peer dependency** (≥ 4.12.0) — only needed for the `/hono` adapter.

> **Upgrading from 0.2.x?** The peer moved from the retired monolithic
> `@modelcontextprotocol/sdk` to `@modelcontextprotocol/server`. Every export still
> works — see [Migrating from 0.2.x](#migrating-from-02x).

## Quick start

### Cloudflare Workers

```ts
import { createWorkerFetch, forwardBearer } from "@maxhealth.tech/mcp-http";
import { McpServer } from "@modelcontextprotocol/server";

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

The default CORS config allows `*` origins and admits the MCP-required request headers (`Content-Type`, `Authorization`, `MCP-Protocol-Version`, `Mcp-Session-Id`, `Last-Event-ID`).

Per-tool `Mcp-Param-*` headers (SEP-2243) are admitted dynamically: any such header a client lists in its preflight `Access-Control-Request-Headers` is echoed back in `Access-Control-Allow-Headers`. Header names outside that prefix are never reflected, so you still declare your own via `allowHeaders`.

`Access-Control-Allow-Methods` is derived per route from the same table that produces the `405` `Allow` header, so preflight only advertises methods the endpoint actually serves (`POST` on the MCP path, `GET` on the well-known documents).

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
  protectedResourcePath, // (mcpPath) => RFC 9728 §3.1 path-aware route
  PROTECTED_RESOURCE_PATH, // "/.well-known/oauth-protected-resource" (bare; compatibility alias)
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
  ├─ GET /.well-known/oauth-protected-resource{mcpPath}  →  RFC 9728 metadata (resource = origin+mcpPath)
  ├─ GET /.well-known/oauth-protected-resource           →  same document (compatibility alias)
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

### Protected-resource metadata route

[RFC 9728 §3.1](https://datatracker.ietf.org/doc/html/rfc9728#section-3.1) forms the metadata URL by inserting `/.well-known/oauth-protected-resource` **between the host and the resource's path**, rather than appending the resource path to a fixed well-known URL. So a resource at `https://api.example.com/mcp` publishes its metadata at:

```
https://api.example.com/.well-known/oauth-protected-resource/mcp
```

That is the route this package serves, and the URL advertised in the `WWW-Authenticate: Bearer resource_metadata="…"` challenge on a 401. Use `protectedResourcePath(mcpPath)` to compute it yourself:

```ts
import { protectedResourcePath } from "@maxhealth.tech/mcp-http";

protectedResourcePath("/mcp"); // "/.well-known/oauth-protected-resource/mcp"
protectedResourcePath("/api/v1/mcp"); // "/.well-known/oauth-protected-resource/api/v1/mcp"
protectedResourcePath("/"); // "/.well-known/oauth-protected-resource"
```

A root-mounted resource has no path component to insert, so it uses the bare well-known path.

The bare path is **also** served, for every mount point, as a compatibility alias. Versions up to and including 0.2.1 served only the bare path, so clients that discovered the endpoint against an older release keep working. Prefer the path-aware route in new code.

## Migrating from 0.2.x

0.3.0 re-layers this package on the official v2 SDK. **No export was removed or changed**, so most upgrades are a dependency swap:

```diff
- npm install @modelcontextprotocol/sdk
+ npm install @modelcontextprotocol/server
```

```diff
- import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
+ import { McpServer } from "@modelcontextprotocol/server";
```

The monolithic `@modelcontextprotocol/sdk` was retired in favour of focused packages; `@modelcontextprotocol/server` went stable at 2.0.0 on 2026-07-27. `McpServer` and `WebStandardStreamableHTTPServerTransport` are API-compatible across the two, which is why nothing else has to change.

### What the SDK now does better

Several things this package used to own are available directly from the SDK, usually with more capability. Where that is true the wrapper here is marked `@deprecated` and will be removed in 0.4.0. Your editor will point you at the replacement.

| Deprecated here                         | Use instead                           | Why                                                                                                         |
| --------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `handleMcpPost`                         | `createMcpHandler`                    | Also serves the 2026-07-28 revision, its `resultType` discriminator, and `-32020 HeaderMismatch` validation |
| `handleMcpPostStateful`, `SessionStore` | `createMcpHandler`                    | Sessions are removed in 2026-07-28; this path is 2025-era only                                              |
| `buildProtectedResourceMetadata`        | `buildOAuthProtectedResourceMetadata` | Takes your real RFC 8414 document rather than a bare issuer URL                                             |

**One incompatibility worth knowing before you migrate off `handleMcpPost`.** `createMcpHandler`'s `onerror` option is reporting-only and, per the SDK's documentation, "never alters the response". `onError` here may return a `Response` to override the reply. If you depend on that, keep using `handleMcpPost` for now — that same incompatibility is why this package still drives the transport itself instead of delegating.

### What this package still owns

The SDK has no equivalent for these, so they are not going anywhere:

- **CORS** — the SDK ships none at all. Route-aware preflight, `Mcp-Param-*` prefix admission, and the shared route table live here.
- **`forwardBearer(token)`** — on-behalf-of upstream `fetch`.
- **JWT `exp` pre-check** — cheap local rejection with clock-skew buffer, before any verifier round-trip.
- **`onRequest` / `onError`** hooks.
- **One-call wiring** — `createMcpHttpHandler` and the Hono / Pages adapters.

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
