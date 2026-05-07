# `@maxhealth.tech/mcp-http` — Plan

## Problem

Every MCP server we deploy over HTTP duplicates the same ~70 lines of boilerplate:

- CORS headers
- `/.well-known/oauth-protected-resource` (RFC 9728)
- `/.well-known/oauth-authorization-server` (RFC 8414) — optional proxy
- Bearer token extraction + 401 gate
- `fetchFn` construction that forwards the Bearer to upstream APIs
- `WebStandardStreamableHTTPServerTransport` lifecycle (connect → handleRequest → `new Response(body)` → `server.close()`)
- `isJwtExpired()` guard for early 401 before expensive upstream calls
- Accept header normalization shim (SSE-only clients)
- 500 error catch with JSON-RPC error body

Current duplication:

- `AIHR/packages/portal/src/api/mcp.ts` — 132 lines, ~63 boilerplate
- `dicom-viewer/functions/mcp/index.ts` — 162 lines, ~77 boilerplate

---

## What This Is NOT

- **Not** a replacement for Cloudflare's `OAuthProvider` — that acts as the OAuth AS itself. This is for the **resource server** side: validating incoming Bearers and pointing clients at an _existing_ external AS.
- **Not** Cloudflare-specific — uses only Web Fetch API (`Request`, `Response`, `Headers`). Works on Workers, Pages Functions, Deno Deploy, Bun, Node 18+, and any Hono deployment.
- **Not** a full MCP framework — consumers still create their own `McpServer` and register their own tools. This only handles the HTTP transport + OAuth plumbing.
- **Not** a token validator. We do **not** verify JWT signatures, JWKS, or claims. The upstream API (FHIR/DICOM) is the source of truth — if the token is bad, upstream will 401 and we surface it. The optional `exp` pre-check is a latency optimization, **not a security control**.
- **Not** stateful. No sessions, no Durable Objects, no SSE resumption. One request → one response.

---

## Design Principles

1. **Web Fetch first.** The core never imports Hono, Cloudflare, Node, or Bun types. Adapters are thin.
2. **Zero magic.** Every behavior is opt-in or opt-out via a typed config field. No env-var sniffing, no global state.
3. **Composable, not monolithic.** Consumers can use `createMcpHttpHandler` whole, or import `handleMcpPost`, `buildProtectedResourceMetadata`, `forwardBearer` à la carte.
4. **Spec-correct by default.** RFC 9728 well-known docs live at the **origin root**, not under the MCP route prefix. The package enforces this and warns when misconfigured.
5. **Fail loud at boundaries.** Bad config throws at handler construction; bad runtime input returns a typed 4xx with a JSON-RPC error body.

---

## Proposed API

### Core: framework-agnostic `Request → Response` handler

```ts
import { createMcpHttpHandler, forwardBearer } from '@maxhealth.tech/mcp-http';

const handler = createMcpHttpHandler({
  /** External OAuth Authorization Server base URL (the issuer). */
  authorizationServer: 'https://beta.proxy-smart.com',

  /** Path the MCP endpoint is mounted at. Default: '/mcp'. */
  mcpPath?: '/mcp',

  /**
   * Factory called per-request after Bearer extraction (and optional `exp`
   * check) but BEFORE upstream validation. Return a configured McpServer.
   *
   * `ctx` carries the original Request and a platform-specific bag (env on
   * Workers/Pages, `c` on Hono, undefined elsewhere) so consumers don't need
   * module-scope closures. The factory may be sync or async.
   */
  createServer: (
    bearerToken: string,
    ctx: { request: Request; env?: unknown; waitUntil?: (p: Promise<unknown>) => void }
  ) => McpServer | Promise<McpServer>;

  /**
   * Optional: AS metadata document served at /.well-known/oauth-authorization-server.
   * If omitted, the route is not registered (clients fall back to discovery via
   * the protected-resource doc's `authorization_servers` pointer).
   */
  authorizationServerMetadata?: AuthorizationServerMetadata;

  /**
   * Optional: extra fields merged into /.well-known/oauth-protected-resource.
   * `resource` and `authorization_servers` are always derived from the request
   * URL and `authorizationServer` and cannot be overridden.
   */
  protectedResourceMetadata?: Partial<Omit<ProtectedResourceMetadata,
    'resource' | 'authorization_servers'>>;

  /**
   * Reject tokens whose `exp` is in the past (30s clock-skew buffer) before
   * touching upstream. Pure JWT decode — does NOT verify signatures.
   * Set `false` for opaque tokens. Default: true.
   */
  earlyRejectExpiredTokens?: boolean;

  /** CORS config. Default: permissive (`*`) with MCP-required headers. */
  cors?:
    | false
    | {
        origin?: string | string[] | ((req: Request) => string | null);
        credentials?: boolean;
        maxAge?: number;
        /** Extra request headers to allow beyond the MCP defaults. */
        allowHeaders?: string[];
        /** Extra response headers to expose beyond the MCP defaults. */
        exposeHeaders?: string[];
      };

  /**
   * Hook for structured logging / tracing. Called once per request with the
   * outcome. Never throws — errors here are swallowed.
   */
  onRequest?: (event: McpRequestEvent) => void | Promise<void>;

  /**
   * Hook for unhandled errors during transport. Default: console.error.
   * Return a Response to override the default 500 JSON-RPC error body.
   */
  onError?: (err: unknown, req: Request) => Response | void | Promise<Response | void>;
});

// Returns a (request: Request, ctx?: PlatformCtx) => Promise<Response>
export default { fetch: handler };
```

### Hono adapter

```ts
import { mcpHono } from "@maxhealth.tech/mcp-http/hono";
import { forwardBearer } from "@maxhealth.tech/mcp-http";
import { Hono } from "hono";

const app = new Hono();

// Mount on the TOP-LEVEL app — well-known docs MUST be reachable at the
// origin root per RFC 9728. Mounting on a sub-router would put them under
// /sub/.well-known/* which violates the spec.
app.route(
  "/",
  mcpHono({
    authorizationServer: PROXY_SMART_BASE,
    createServer: (token, { c }) =>
      createFhirMcpServer({
        fhirUrl: c.env.FHIR_BASE_URL,
        fetchFn: forwardBearer(token),
      }),
  }),
);
```

The Hono adapter passes `{ request, env, waitUntil, c }` (the Hono `Context`) into `createServer`.

### Cloudflare Pages Function adapter

```ts
// functions/[[path]].ts — catch-all so /mcp AND /.well-known/* both resolve here
import { mcpPagesFunction } from "@maxhealth.tech/mcp-http/cloudflare";
import { forwardBearer } from "@maxhealth.tech/mcp-http";

export const onRequest = mcpPagesFunction({
  authorizationServer: "https://beta.proxy-smart.com",
  createServer: (token, { env }) =>
    createDicomMcpServer({
      fhirUrl: env.FHIR_BASE_URL,
      fetchFn: forwardBearer(token),
    }),
});
```

The adapter handles the `EventContext` → `Request` unwrap and forwards `env`, `waitUntil`, `passThroughOnException`.

### À la carte primitives

For consumers needing finer control (custom routing, mixing into an existing handler):

```ts
import {
  forwardBearer,
  extractBearer,
  isJwtExpired,
  buildProtectedResourceMetadata,
  buildAuthorizationServerMetadata,
  applyCors,
  handleMcpPost,
} from "@maxhealth.tech/mcp-http";
```

All primitives are pure functions over Web Fetch types.

---

## What the Package Handles

| Concern                                                           | Included                   |
| ----------------------------------------------------------------- | -------------------------- |
| CORS (configurable origin, MCP-required headers)                  | ✅                         |
| OPTIONS preflight                                                 | ✅                         |
| GET / DELETE / non-POST on `/mcp` → 405                           | ✅                         |
| `/.well-known/oauth-protected-resource` (RFC 9728, origin root)   | ✅                         |
| `/.well-known/oauth-authorization-server` (RFC 8414, origin root) | ✅ (optional)              |
| Bearer extraction from `Authorization` header                     | ✅                         |
| 401 with `WWW-Authenticate: Bearer resource_metadata=...`         | ✅                         |
| JWT `exp` pre-check, 30s buffer (opt-out)                         | ✅                         |
| `Accept` header normalization (SSE-only clients)                  | ✅                         |
| `WebStandardStreamableHTTPServerTransport` lifecycle              | ✅                         |
| `new Response(body, ...)` materialization (stream safety)         | ✅                         |
| `server.close()` in `finally`, even on throw                      | ✅                         |
| 500 → JSON-RPC error body (overridable via `onError`)             | ✅                         |
| `forwardBearer(token)` fetch wrapper                              | ✅                         |
| Structured `onRequest` hook for logs/traces                       | ✅                         |
| Tool registration, FHIR, DICOM                                    | ❌ (consumer's job)        |
| JWT signature / JWKS verification                                 | ❌ (delegated to upstream) |
| Token introspection (RFC 7662)                                    | ❌                         |
| Session state, Durable Objects, SSE resumption                    | ❌                         |

---

## Package Structure

```
mcp-http/
  src/
    index.ts                 # public exports + createMcpHttpHandler orchestration
    handler.ts               # method routing, well-known dispatch, auth gate
    transport.ts             # handleMcpPost — transport lifecycle, Response materialization
    well-known.ts            # buildProtectedResourceMetadata, buildAuthorizationServerMetadata
    cors.ts                  # applyCors, preflight
    jwt.ts                   # isJwtExpired, extractBearer (pure, dep-free)
    fetch.ts                 # forwardBearer
    errors.ts                # JsonRpcError, toJsonRpcErrorResponse
    types.ts                 # shared types (config, metadata, hooks)
  hono/
    index.ts                 # mcpHono — Hono middleware
  cloudflare/
    index.ts                 # mcpPagesFunction — Pages Function adapter
  test/
    handler.test.ts
    jwt.test.ts
    well-known.test.ts
    cors.test.ts
    transport.test.ts
    integration.cloudflare.test.ts   # miniflare-based
    integration.hono.test.ts
  package.json               # exports map: ".", "./hono", "./cloudflare"
  tsconfig.json
```

Each file ≤ 700 LOC. `index.ts` is orchestration only.

**Dependencies:**

- `@modelcontextprotocol/sdk` (peer) — `WebStandardStreamableHTTPServerTransport`, `McpServer`
- `hono` (peer, optional) — only for `/hono` subpath
- Zero runtime dependencies beyond the above
- Bundle budget: **< 8 KB min+gzip** for the core entry (excluding peer deps)

---

## Migration: AIHR portal

**Before** (`packages/portal/src/api/mcp.ts` — 132 lines): manual CORS, well-known routes, transport lifecycle.

**After** (~20 lines):

```ts
import { mcpHono } from "@maxhealth.tech/mcp-http/hono";
import { forwardBearer } from "@maxhealth.tech/mcp-http";

app.route(
  "/",
  mcpHono({
    authorizationServer: PROXY_SMART_BASE,
    authorizationServerMetadata: {
      issuer: PROXY_SMART_BASE,
      authorization_endpoint: `${PROXY_SMART_BASE}/auth/authorize`,
      token_endpoint: `${PROXY_SMART_BASE}/auth/token`,
      registration_endpoint: `${PROXY_SMART_BASE}/auth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
    },
    createServer: (token, { c }) =>
      createFhirMcpServer({
        fhirUrl: c.env.fhirBaseUrl,
        fetchFn: forwardBearer(token),
      }),
  }),
);
```

## Migration: dicom-viewer Pages Function

**Before** (`functions/mcp/index.ts` — 162 lines): manual handler.

**After** (~15 lines, in `functions/[[path]].ts` so well-known resolves at root):

```ts
import { mcpPagesFunction } from "@maxhealth.tech/mcp-http/cloudflare";
import { forwardBearer } from "@maxhealth.tech/mcp-http";

export const onRequest = mcpPagesFunction({
  authorizationServer: "https://beta.proxy-smart.com",
  createServer: (token, { env }) =>
    createDicomMcpServer({
      strategy: "stateless",
      fhirUrl: env.FHIR_BASE_URL ?? "https://hapi.fhir.org/baseR4",
      fetchFn: forwardBearer(token),
      dicomwebProxyBase: env.DICOMWEB_PROXY_BASE,
      accessToken: token,
    }),
});
```

---

## Success Criteria

**Functional**

- [ ] `createMcpHttpHandler` works in a bare Cloudflare Worker (`export default { fetch }`)
- [ ] `mcpHono` is a drop-in replacement for AIHR's `mcpRoute` boilerplate
- [ ] `mcpPagesFunction` is a drop-in for dicom-viewer's `onRequest`
- [ ] `/.well-known/oauth-protected-resource` returns RFC 9728-correct JSON at the **origin root**, regardless of `mcpPath`
- [ ] `/.well-known/oauth-authorization-server` returns RFC 8414-correct JSON when `authorizationServerMetadata` is provided
- [ ] 401 + `WWW-Authenticate: Bearer resource_metadata="..."` when no Bearer present
- [ ] 401 when JWT `exp` is past (30s buffer) and `earlyRejectExpiredTokens !== false`
- [ ] `server.close()` runs in `finally` even when `handleRequest` throws (verified by spy)
- [ ] CORS `origin` accepts string, array, and function forms
- [ ] `createServer` may be async; rejected promises surface as 500 via `onError`
- [ ] VS Code `aihr-mcp` and `dicom-mcp` both connect after migration

**Architectural**

- [ ] Zero Cloudflare-specific imports in `src/**` and `hono/**`
- [ ] Zero Hono imports in `src/**` and `cloudflare/**`
- [ ] `src/index.ts` ≤ 200 LOC (orchestration only)
- [ ] All files ≤ 700 LOC
- [ ] Core entry < 8 KB min+gzip

**Quality**

- [ ] `bun test` green; coverage ≥ 90% on `src/`
- [ ] `isJwtExpired` unit tests cover: missing `exp`, malformed segments, leading whitespace, non-numeric `exp`, `exp` exactly now ± buffer
- [ ] Integration test: full request → tool call → response, asserts CORS + auth headers
- [ ] `tsc --noEmit` clean under `strict`
- [ ] ESLint + Prettier clean
- [ ] Published as **public** package under `@maxhealth.tech` scope; `npm publish --access public` documented in CI

---

## Out of Scope (v1) — track for v2

- Token introspection / JWKS validation (would let us 401 _correctly_ without an upstream round-trip)
- Stateful sessions / SSE resumption / Durable Objects backend
- Streaming progress notifications mid-request
- Multi-tenant routing (one handler, many `authorizationServer`s by Host header)
- Rate limiting / quota enforcement

---

## Priority: High

Blocks every future MCP server we build. ~140 lines of copy-paste already diverging across two repos (AIHR lacks `isJwtExpired`, dicom-viewer lacks the AS metadata route). Each divergence is a future debugging session and a future security incident.
