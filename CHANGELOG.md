# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `discoverAuthorizationServer` option — when `true`, fetches and proxies the AS metadata document from `{authorizationServer}/.well-known/oauth-authorization-server` on first request; result is cached, failures are retried

### Fixed

- `resource` field in `/.well-known/oauth-protected-resource` now correctly uses `origin + mcpPath` (e.g. `https://example.com/mcp`) instead of bare origin, per RFC 9728 §2 — fixes VS Code MCP client connection errors
- `server.close()` is now deferred until the SSE response body is fully consumed; previously the `finally` block closed the server immediately, killing streaming responses before the client could read them
- `authorizationServer` trailing slash is stripped at handler construction time to prevent double-slash discovery URLs and incorrect `authorization_servers` values
- `cors: false` + OPTIONS to `/mcp` no longer advertises `OPTIONS` in the `Allow` header (it is only listed when CORS is enabled and OPTIONS is handled)
- Unmatched routes now report outcome `"not-found"` instead of `"error"` in `onRequest` hooks; `"error"` is now reserved for actual 5xx server errors

### Changed

- `buildProtectedResourceMetadata` first parameter renamed from `requestUrl` to `resourceUrl` — callers are expected to pass the full resource URL, not the raw request URL

## [0.1.1] — 2026-05-08

### Added

- `repository` field in `package.json` required for npm provenance verification
- `files` whitelist in `package.json` (`dist/`, `README.md`) to ensure correct tarball contents
- `prepublishOnly` script runs full `check` before publish
- GitHub Actions: `ci-check.yml`, `release.yml`, `publish.yml` with OIDC trusted publishing

### Fixed

- Non-ASCII characters (`→`, `──`, `✅`) removed from `release.yml` — GitHub YAML parser silently skipped the workflow

## [0.1.0] — 2026-05-08

### Added

- Initial release of `@maxhealth.tech/mcp-http`
- Framework-agnostic `createMcpHttpHandler` — maps `Request → Promise<Response>`
- `createWorkerFetch` — Cloudflare Workers-compatible `{ fetch }` export
- `mcpHono` adapter for [Hono](https://hono.dev/)
- `mcpPagesFunction` adapter for Cloudflare Pages Functions
- `GET /.well-known/oauth-protected-resource` (RFC 9728) served automatically
- `GET /.well-known/oauth-authorization-server` (RFC 8414) — optional static proxy
- Bearer extraction + 401 gate with `WWW-Authenticate: Bearer resource_metadata=` pointer
- JWT `exp` early-rejection with 30-second clock-skew buffer (opt-out via `earlyRejectExpiredTokens: false`)
- Stateless `WebStandardStreamableHTTPServerTransport` per POST request
- `Accept` header normalisation — injects `application/json, text/event-stream` for older clients
- CORS middleware with permissive defaults, per-origin configuration, and opt-out
- `forwardBearer(token)` — wraps `fetch` to inject the caller's Bearer token into upstream requests
- `onRequest` observability hook — outcome, HTTP status, and duration per request
- `onError` hook — override the default JSON-RPC 500 response
- `PlatformCtx` — passes `env` and `waitUntil` through to `createServer`
- Full TypeScript types exported (`McpHttpHandlerConfig`, `AuthorizationServerMetadata`, `ProtectedResourceMetadata`, etc.)
- 107 tests, 98%+ line coverage

[Unreleased]: https://github.com/Max-Health-Inc/mcp-http/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/Max-Health-Inc/mcp-http/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Max-Health-Inc/mcp-http/releases/tag/v0.1.0
