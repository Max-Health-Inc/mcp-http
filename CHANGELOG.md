# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.1] — 2026-07-31

### Fixed

- **Spec** — Protected-resource metadata is now served at the [RFC 9728 §3.1](https://datatracker.ietf.org/doc/html/rfc9728#section-3.1) path-aware route. The spec forms the metadata URL by inserting the well-known segment _between the host and the resource path_, so an endpoint mounted at `/mcp` publishes at `/.well-known/oauth-protected-resource/mcp`. Up to and including 0.2.1 only the bare `/.well-known/oauth-protected-resource` was served, and the `WWW-Authenticate` challenge pointed there, which is off-spec for any non-root mount point. The bare path is still served as a compatibility alias, so this is not a breaking change; the `WWW-Authenticate` `resource_metadata` pointer now advertises the path-aware URL. Found by diffing our behaviour against `@modelcontextprotocol/server@2.0.0`, which implements the rule correctly.
- **Release tooling** — `scripts/changelog-release.ts` now maintains the link-reference block when it stamps a version: `[Unreleased]` is repointed at the new tag and a `[<version>]` compare link is inserted beneath it. The 0.2.0 release exposed this gap, shipping with `[Unreleased]` still comparing from `v0.1.6` and no `[0.2.0]` link at all. The repository URL and previous tag are derived from the existing `[Unreleased]` line rather than hardcoded, so the script stays portable to the other repos using it. Changelogs that keep no link block are left untouched.
- Backfilled the `[0.2.0]` link reference that the 0.2.0 release itself could not add.
- Corrected a line in the 0.2.0 entry that still claimed merging to `main` publishes nothing, contradicting the release-on-merge entry directly above it.

### Added

- `protectedResourcePath(mcpPath)` applies the RFC 9728 §3.1 path-insertion rule, for consumers that need to compute the metadata route themselves.
- **CI** — `.github/dependabot.yml`, so CI actions and npm dependencies stay current without a manual sweep. Mirrors the org config in `Max-Health-Inc/armband` and `sleeptracker`, extended with the npm ecosystem and grouped so each ecosystem opens one PR a week rather than one per dependency. It targets `develop`, not `main`: merging to `main` publishes, so a routine bump landing there would cut a release. TypeScript major updates are ignored for now because `typescript-eslint` still caps `typescript` below `6.1.0`; a grouped PR would otherwise fail every week and block the other updates.

### Changed

- **CI** — Actions updated to current majors: `actions/setup-node` v4 → v7 (this was the Node 20 deprecation warning on every publish run) and `softprops/action-gh-release` v2 → v3 (a Node 20 → 24 runtime move, no API change). `actions/checkout` is already on v7 and `oven-sh/setup-bun@v2` is current. The Node used for npm publishing moves from 22 to 24, the current LTS, matching the node24 runtime the actions themselves now use.

## [0.2.0] — 2026-07-31

### Fixed

- **CORS** — `MCP-Protocol-Version` is now in `Access-Control-Allow-Headers`. That header has been required on every MCP HTTP request since protocol version 2025-06-18 and is not CORS-safelisted, so every browser-hosted MCP client previously failed preflight and never reached the endpoint. ([#7](https://github.com/Max-Health-Inc/mcp-http/issues/7))
- **CORS** — `Access-Control-Allow-Methods` is now derived per route instead of being hardcoded to `GET, POST, DELETE, OPTIONS`. Preflight was advertising `GET` and `DELETE` on the MCP endpoint while the handler answered those with `405 Method Not Allowed`. Both the preflight value and the `405` `Allow` header now come from one table in `src/routes.ts`, and a test asserts they agree. ([#7](https://github.com/Max-Health-Inc/mcp-http/issues/7))
- **CORS** — Per-tool `Mcp-Param-*` request headers (SEP-2243) are now admitted. Their names are chosen by the server per tool, so a fixed list structurally cannot cover them; matching headers listed in the preflight `Access-Control-Request-Headers` are echoed back. Names outside the prefix are not reflected. ([#7](https://github.com/Max-Health-Inc/mcp-http/issues/7))
- **CORS** — `Access-Control-Expose-Headers` is omitted rather than emitted with an empty value when the expose list is empty.

### Added

- `handlePreflight()` accepts an optional third `PreflightRouteOptions` argument (`{ mcpPath }`) so route-accurate methods can be advertised when the endpoint is not mounted at the default `/mcp`. Existing two-argument calls keep working.
- `DEFAULT_MCP_PATH`, `allowedMethodsFor()` and `allowMethodsValue()` are exported for consumers composing their own routing.
- **Release tooling** — `scripts/changelog-release.ts`, a release-time changelog gate ported from the org-canonical implementation in `Max-Health-Inc/prefab`. It fails the release when the version about to ship has nothing documented, and otherwise promotes `[Unreleased]` to `## [<version>] — <date>`. Wired into `release.yml` before the version bump, and `CHANGELOG.md` is now committed alongside `package.json` in the release commit. Previously a release left the changelog saying "Unreleased" indefinitely.
- **Release tooling** — `release.yml` now honours an intentional version bump: if `package.json` is strictly ahead of the npm latest, that version ships instead of a forced patch bump. Also ported from `prefab`. Previously the workflow always patch-bumped and explicitly ignored `package.json`, so a minor or major release was impossible without editing the workflow.
- **Release tooling** — **merging to `main` now publishes to npm.** `release.yml` gained a `push: branches: [main]` trigger alongside `workflow_dispatch`, and is split into a `gate` job that decides whether a release is warranted and a `release` job that runs only when it is. A merge that documents nothing under `## [Unreleased]` skips the release cleanly rather than failing, so a README or CI-only merge does not redden `main`; an explicit `workflow_dispatch` with an empty changelog still fails loudly. The release commit pushed back to `main` does not re-trigger the workflow, because pushes made with `GITHUB_TOKEN` never start another run.
- **Release tooling** — `scripts/changelog-release.ts` gained a `--check <version>` mode that reports the status on stdout, writes nothing, and always exits 0. The gate job branches on it.
- **CI** — `auto-pr.yml` keeps a standing `develop → main` promotion PR open. It mirrors the org reusable workflow at `Max-Health-Inc/.github/.github/workflows/create-pr.yml` rather than calling it, because GitHub does not permit a public repository to consume a reusable workflow from a private one and the `.github` repo is private. Merging that PR publishes, per the release-on-merge entry above.

### Changed

- Dependencies updated to latest in-range versions: `@modelcontextprotocol/sdk` 1.29.0 → 1.30.0, `@types/bun` 1.3.13 → 1.3.14, `eslint` 10.3.0 → 10.8.0, `hono` 4.12.18 → 4.12.33, `prettier` 3.8.3 → 3.9.6, `typescript-eslint` 8.59.2 → 8.65.0. Published `peerDependencies` ranges are unchanged (`@modelcontextprotocol/sdk >=1.29.0`, `hono >=4.12.0`) so consumers are not forced to upgrade.
- `typescript` stays at 6.0.3. TypeScript 7.0.2 is available but `typescript-eslint@8.65.0` still declares a `typescript: >=4.8.4 <6.1.0` peer range, so the lint step cannot support it yet.

### Fixed

- Added `.gitattributes` with `* text=auto eol=lf`. Without it, `core.autocrlf=true` on Windows checks files out with CRLF while Prettier is configured with `endOfLine: "lf"`, making `bun run format:check` fail on files that had no actual content change.

## [0.1.6] — 2026-05-31

### Changed

- **Breaking** — `PlatformCtx` and `McpHttpHandlerConfig` are now generic on `Env` (`PlatformCtx<Env = unknown>`, `McpHttpHandlerConfig<Env = unknown>`). `ctx.env` is typed as `Env` instead of `unknown`, and the type parameter is threaded through `createServer`, `createWorkerFetch<Env>` and `mcpPagesFunction<Env>`. Code relying on the `unknown` default is unaffected; code that explicitly annotated these types must add the parameter.

### Fixed

- `SessionStore` is now initialised lazily rather than at module scope, fixing the Cloudflare Workers "global scope" error thrown when a timer is created during module evaluation.

## [0.1.5] — 2026-05-31

### Added

- `createWorkerFetch<Env>` accepts a generic type parameter so the Workers `env` binding is typed at the call site instead of falling back to `unknown`.

## [0.1.4] — 2026-05-31

### Added

- Stateful session support for server-initiated RPC (e.g. `sampling/createMessage`). Adds the `SessionStore` class for TTL-managed persistent transport sessions, `handleMcpPostStateful()` for session-based request routing, and the `stateful` / `sessionTtlMs` options on `McpHttpHandlerConfig`. The existing stateless `handleMcpPost()` path is unchanged and remains the default.

### Fixed

- `authorizationServer` is now optional, so the handler can serve public endpoints that do not sit behind an OAuth Authorization Server.
- `prepublishOnly` script corrected so the pre-publish gate actually runs.

## [0.1.3] — 2026-05-08

### Fixed

- **Security** — `applyCors()` now throws at call-time when `credentials: true` is paired with a wildcard origin (`"*"` or omitted). This combination is spec-invalid (browsers silently ignore `Allow-Credentials` with a wildcard origin) and previously emitted misleading headers without any warning.
- **Security** — Discovered Authorization Server metadata is now cached with a 5-minute TTL (previously cached for the lifetime of the process). Stale metadata is now re-fetched after the TTL expires, preventing prolonged serving of outdated AS endpoint URLs after key rotation or configuration changes.

### Documentation

- **Security** — `forwardBearer()` JSDoc now includes an explicit SSRF / credential-exfiltration warning: callers must never pass URLs derived from untrusted input (e.g. MCP tool arguments) to the returned fetch function.
- `unauthorizedResponse()` internal JSDoc clarifies the Host-header trust assumption and recommends running behind a normalising reverse proxy on non-Cloudflare deployments.

## [0.1.2] — 2026-05-08

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

[Unreleased]: https://github.com/Max-Health-Inc/mcp-http/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/Max-Health-Inc/mcp-http/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Max-Health-Inc/mcp-http/compare/v0.1.6...v0.2.0
[0.1.6]: https://github.com/Max-Health-Inc/mcp-http/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/Max-Health-Inc/mcp-http/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/Max-Health-Inc/mcp-http/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/Max-Health-Inc/mcp-http/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Max-Health-Inc/mcp-http/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Max-Health-Inc/mcp-http/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Max-Health-Inc/mcp-http/releases/tag/v0.1.0
