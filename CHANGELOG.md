# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Breaking — the modern protocol path is delegated to `createMcpHandler`.** 0.3.0 swapped the peer dependency to `@modelcontextprotocol/server` v2 but kept driving `WebStandardStreamableHTTPServerTransport`, which is the 2025-era transport: sessions, `Mcp-Session-Id`, and validation limited to `mcp-protocol-version` against a version list. The endpoint therefore never served 2026-07-28. It does now, and gets `server/discover`, the `_meta` envelope, MRTR, `resultType` and the inbound validation ladder that emits `-32020` `HeaderMismatch` from the SDK rather than from code here. `legacy` is left at its default `'stateless'`, so 2025-era clients continue to be served, one fresh instance per request. This closes [#8](https://github.com/Max-Health-Inc/mcp-http/issues/8) and the `-32020` item from [#6](https://github.com/Max-Health-Inc/mcp-http/issues/6).
- **Breaking — `handleMcpPost` takes a `createServer` factory** instead of a constructed `server`, because the SDK builds one instance per serving unit, per era. The `onError` contract is unchanged, including the `Response` override that `createMcpHandler`'s reporting-only `onerror` cannot express; out-of-band SDK reports are captured and routed through it alongside anything thrown.
- **`mcpHono` builds its handler once** rather than per request. Rebuilding per request silently defeated the authorization-server metadata cache, which lives in the handler's closure, so a `discoverAuthorizationServer` endpoint re-fetched the AS document on every request instead of once per TTL. The Hono `Context` is threaded through `PlatformCtx` instead.

### Fixed

- **A disconnecting client raised an unhandled promise rejection.** The response body is piped through a `TransformStream` so the server is closed only once the body drains. Cancelling that pipe — which is what a client disconnecting mid-response does — rejects `pipeTo`, and `.finally()` re-raises it, so the rejection was never handled. This is not an SSE edge case: the SDK returns a `ReadableStream` body for ordinary JSON replies too, so it fired on any cancelled request, which on Workers is routine traffic. The pipe and the subsequent `close()` now both swallow their errors. Present in the 0.3.x transport as well, under the same `void pipeTo(...).finally(...)` shape. Found by a test that installs an `unhandledRejection` listener, cancels the body, and asserts nothing fires; it fails against the unfixed version.

### Removed

- **Breaking** — `handleMcpPostStateful`, `SessionStore`, and the `stateful` / `sessionTtlMs` options, all deprecated in 0.3.0 and scheduled for this release. Sessions do not exist in 2026-07-28 and server-initiated sampling is replaced by in-result input requests, so there is no replacement to migrate to. Nothing in the known consumer set (`dicom-viewer`, `drypdf`, `legal-web`) used them.
- **Breaking** — `Mcp-Session-Id` and `Last-Event-ID` from the default CORS allow-list, and `Mcp-Session-Id` from the exposed headers. The revision no longer defines them. With no default exposed headers left, `Access-Control-Expose-Headers` is omitted rather than emitted empty.
- The `@modelcontextprotocol/sdk` v1 devDependency, dead since the 0.3.0 peer swap and imported nowhere.

## [0.3.2] — 2026-08-07

### Fixed

- **CORS** — `Mcp-Method` and `Mcp-Name` are required request headers on the 2026-07-28 revision and were absent from `Access-Control-Allow-Headers`, so a browser-hosted client on that revision failed preflight before its POST was ever sent. They are request headers, so they belong in the allow list; [#6](https://github.com/Max-Health-Inc/mcp-http/issues/6) originally proposed `Access-Control-Expose-Headers`, which is the wrong list. `Mcp-Session-Id` and `Last-Event-ID` stay for now because this package still drives the sessionful transport, and go when that path does.
- **JWT** — the payload segment was decoded with `atob` alone, which yields latin1, one character per byte. Beyond returning mojibake for any multi-byte claim, this accepted tokens it should have rejected: a payload that is invalid UTF-8 can still parse as well-formed JSON when misread as latin1, so `exp` was read from a token the decoder had no business trusting. Decoding now goes through `TextDecoder("utf-8", { fatal: true })`. No dependency added, so the package stays dependency-free; the regression test builds a payload that is invalid UTF-8 yet valid JSON in latin1 and fails against the old implementation. Partially addresses [#15](https://github.com/Max-Health-Inc/mcp-http/issues/15), whose `validateJwtAccessToken` proposal remains open as a separate design decision, since this package deliberately delegates signature verification upstream.

### Notes

- [#6](https://github.com/Max-Health-Inc/mcp-http/issues/6)'s remaining `-32020` `HeaderMismatch` item is reassigned to [#8](https://github.com/Max-Health-Inc/mcp-http/issues/8). Verified against `@modelcontextprotocol/server` 2.0.0: the inbound validation ladder that emits it — header/body cross-checks plus SEP-2243 `Mcp-Param-*` validation against each tool's `x-mcp-header` declarations, with base64 sender-encoding and numeric canonicalisation — exists only on the `createMcpHandler` path. It arrives by delegating in 0.4.0 rather than by being reimplemented here. #6's 405 item was already fixed and is closed.

## [0.3.1] — 2026-08-01

### Fixed

- **Docs** — the "Migrating from 0.2.x" guide claimed the v2 `McpServer` is API-compatible and "nothing else has to change". That holds for this package's own exports, but not the SDK: v2 removed the short-form `server.tool()` / `server.resource()` / `server.prompt()` aliases that v1 accepted, so a `createServer` using them fails to type-check after the swap. The guide now lists the `register*` renames (identical signatures). Surfaced by a downstream `0.1.6 → 0.3.0` bump that broke on `server.resource()`.
- **Release tooling** — `publish.yml` now resolves the npm dist-tag instead of always taking `latest`. `npm publish` moves `latest` to whatever it published most recently, by recency rather than version order, so publishing a backport would hand every new install the older line. The workflow compares the version being published against what `latest` currently points at and uses `legacy` when it is not the highest. Caught while shipping the 0.2.2 backport, which would otherwise have displaced 0.3.0 as `latest`. Verified across five cases including `0.10.0` vs `0.9.0`, which a string comparison gets wrong.

### Added

- **0.2.x line** — the RFC 9728 §3.1 path-aware metadata route is backported as [0.2.2](https://github.com/Max-Health-Inc/mcp-http/releases/tag/v0.2.2), published under the `legacy` dist-tag, for consumers who cannot yet move to the `@modelcontextprotocol/server` v2 peer that 0.3.0 requires. Install with `npm i @maxhealth.tech/mcp-http@legacy`.

## [0.3.0] — 2026-07-31

### Changed

- **Breaking (dependency)** — the peer dependency moves from the retired monolithic `@modelcontextprotocol/sdk` (`>=1.29.0`) to `@modelcontextprotocol/server` (`^2.0.0`). The v2 SDK went stable on 2026-07-27. **No export was removed, renamed, or changed shape**, so the only consumer change is the dependency swap and updating `McpServer` imports to `@modelcontextprotocol/server`; `McpServer` and `WebStandardStreamableHTTPServerTransport` are API-compatible across the two majors. See "Migrating from 0.2.x" in the README. Consumers who cannot move yet should stay on the 0.2.x line.
- The package is repositioned as the OAuth, CORS and observability layer over the official SDK rather than an MCP transport implementation, and the description reflects that.
- `protectedResourcePath()` now delegates to `getOAuthProtectedResourceMetadataUrl` from the SDK, so the route can never drift from the SDK's reading of RFC 9728 §3.1. Verified to produce identical output for `/mcp`, nested, root, empty and trailing-slash mount points.
- **CI** — `release.yml` now merges the release commit back into `develop` after publishing, so the promoted changelog and the bumped version reach `develop` immediately instead of diverging until someone notices. The sync is best-effort: a conflict writes a warning to the run summary rather than failing an already-completed release. Without this the two branches differ structurally after every release, which is what mis-filed the 0.2.1 entries.
- **CI** — Actions updated to current majors: `actions/setup-node` v4 → v7 (this was the Node 20 deprecation warning on every publish run) and `softprops/action-gh-release` v2 → v3 (a Node 20 → 24 runtime move, no API change). `actions/checkout` is already on v7 and `oven-sh/setup-bun@v2` is current. The Node used for npm publishing moves from 22 to 24, the current LTS, matching the node24 runtime the actions themselves now use.

### Deprecated

Each of these still works and is scheduled for removal in 0.4.0. They carry `@deprecated` JSDoc with a pointer to the replacement, so editors surface it.

- `handleMcpPostStateful`, `SessionStore`, and the `stateful` / `sessionTtlMs` config options — sessions are removed in the 2026-07-28 revision, which also replaces server-initiated sampling with in-result input requests, so this path has no long-term future.
- `buildProtectedResourceMetadata` — prefer `buildOAuthProtectedResourceMetadata`, passing a real RFC 8414 document. Not delegated internally: the SDK's option type demands `authorization_endpoint`, `token_endpoint` and `response_types_supported` while this package is configured with only an issuer URL, and it reads none of them — delegating would mean fabricating three values that are discarded today and could start leaking if the SDK began emitting them.

### Not deprecated, deliberately

- `handleMcpPost` was initially marked deprecated in favour of `createMcpHandler` and that marker has been removed as misleading. `createMcpHandler` is the better default for new code, but it is not a drop-in replacement: its `onerror` is reporting-only and "never alters the response", whereas `onError` here may return a `Response` to override the reply. More decisively, `createMcpHttpHandler` — the primary, non-deprecated entry point — is built on `handleMcpPost`, so marking it for removal in 0.4.0 was a promise that could not be kept without dropping `onError` from the main API. Attempting the delegation anyway failed 4 existing tests by swallowing errors before `onError` could run. The JSDoc now recommends `createMcpHandler` without deprecating.

### Fixed

- **Changelog accuracy** — the `## [0.2.1]` section wrongly claimed the RFC 9728 path-aware route, the `protectedResourcePath` helper, the Dependabot config and the CI action bumps. None of those are in the published `v0.2.1`, which contains only the changelog link-reference fix; they have been moved back under Unreleased. Cause: promoting `[Unreleased]` on `main` while `develop` had already accumulated new entries leaves git resolving two files whose only structural difference is where the version heading sits, and a line-based merge happily files the newer entries under the older heading. It also emptied `[Unreleased]` on `main`, which is why the follow-up merge skipped its release instead of publishing 0.2.2.

- **Spec** — Protected-resource metadata is now served at the [RFC 9728 §3.1](https://datatracker.ietf.org/doc/html/rfc9728#section-3.1) path-aware route. The spec forms the metadata URL by inserting the well-known segment _between the host and the resource path_, so an endpoint mounted at `/mcp` publishes at `/.well-known/oauth-protected-resource/mcp`. Up to and including 0.2.1 only the bare `/.well-known/oauth-protected-resource` was served, and the `WWW-Authenticate` challenge pointed there, which is off-spec for any non-root mount point. The bare path is still served as a compatibility alias, so this is not a breaking change; the `WWW-Authenticate` `resource_metadata` pointer now advertises the path-aware URL. Found by diffing our behaviour against `@modelcontextprotocol/server@2.0.0`, which implements the rule correctly.

### Added

- `protectedResourcePath(mcpPath)` applies the RFC 9728 §3.1 path-insertion rule, for consumers that need to compute the metadata route themselves.
- **CI** — `.github/dependabot.yml`, so CI actions and npm dependencies stay current without a manual sweep. Mirrors the org config in `Max-Health-Inc/armband` and `sleeptracker`, extended with the npm ecosystem and grouped so each ecosystem opens one PR a week rather than one per dependency. It targets `develop`, not `main`: merging to `main` publishes, so a routine bump landing there would cut a release. TypeScript major updates are ignored for now because `typescript-eslint` still caps `typescript` below `6.1.0`; a grouped PR would otherwise fail every week and block the other updates.

## [0.2.1] — 2026-07-31

### Fixed

- **Release tooling** — `scripts/changelog-release.ts` now maintains the link-reference block when it stamps a version: `[Unreleased]` is repointed at the new tag and a `[<version>]` compare link is inserted beneath it. The 0.2.0 release exposed this gap, shipping with `[Unreleased]` still comparing from `v0.1.6` and no `[0.2.0]` link at all. The repository URL and previous tag are derived from the existing `[Unreleased]` line rather than hardcoded, so the script stays portable to the other repos using it. Changelogs that keep no link block are left untouched.
- Backfilled the `[0.2.0]` link reference that the 0.2.0 release itself could not add.
- Corrected a line in the 0.2.0 entry that still claimed merging to `main` publishes nothing, contradicting the release-on-merge entry directly above it.

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

[Unreleased]: https://github.com/Max-Health-Inc/mcp-http/compare/v0.3.2...HEAD
[0.3.2]: https://github.com/Max-Health-Inc/mcp-http/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/Max-Health-Inc/mcp-http/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/Max-Health-Inc/mcp-http/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/Max-Health-Inc/mcp-http/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Max-Health-Inc/mcp-http/compare/v0.1.6...v0.2.0
[0.1.6]: https://github.com/Max-Health-Inc/mcp-http/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/Max-Health-Inc/mcp-http/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/Max-Health-Inc/mcp-http/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/Max-Health-Inc/mcp-http/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Max-Health-Inc/mcp-http/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Max-Health-Inc/mcp-http/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Max-Health-Inc/mcp-http/releases/tag/v0.1.0
