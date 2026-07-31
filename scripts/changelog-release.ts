/**
 * Release-time CHANGELOG gate + promotion.
 *
 * Guarantees the version about to ship is documented, then stamps it:
 *   - `## [<version>]` already present  → no-op (status `"present"`).
 *   - `## [Unreleased]` has entries     → promote to `## [<version>] — <date>`,
 *                                         leaving a fresh empty `## [Unreleased]`.
 *   - otherwise                         → fail (status `"missing"`).
 *
 * The CLI wrapper exits non-zero on `"missing"` so a release with no changelog
 * entry fails in CI. Run: `bun run scripts/changelog-release.ts <version> [date]`.
 *
 * `--check` reports the status on stdout and always exits 0, writing nothing.
 * The release workflow uses it to decide whether a merge to `main` should cut a
 * release at all, versus one that merely documented nothing.
 *
 * Ported from the org-canonical implementation in Max-Health-Inc/prefab.
 */

import { readFileSync, writeFileSync } from "node:fs";

export type ChangelogStatus = "promoted" | "present" | "missing";

export interface ChangelogResult {
  status: ChangelogStatus;
  /** Rewritten changelog (for `"promoted"`), or the unchanged input (for `"present"`). */
  content?: string;
  message: string;
}

const UNRELEASED = /^##\s*\[Unreleased\][^\n]*$/m;

/**
 * The `[Unreleased]: <base>/compare/<prevTag>...HEAD` link reference at the foot of a
 * Keep a Changelog file. Both the compare base and the previous tag are captured so a
 * new version's link can be derived without hardcoding the repository URL.
 */
const UNRELEASED_LINK = /^\[Unreleased\]:\s*(\S+\/compare\/)(\S+?)\.\.\.HEAD[ \t]*$/m;

/** Escape a version string for safe embedding in a RegExp. */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Maintain the link-reference block when a version is stamped.
 *
 * Repoints `[Unreleased]` at the new tag and inserts a `[<version>]` compare link
 * beneath it. Returns the input untouched when the file keeps no link references, or
 * when they already point at this version.
 */
function updateLinkRefs(md: string, version: string): string {
  const match = UNRELEASED_LINK.exec(md);
  if (match === null) return md;

  const line = match[0];
  const compareBase = match[1];
  const prevTag = match[2];
  if (compareBase === undefined || prevTag === undefined) return md;

  const newTag = `v${version}`;
  if (prevTag === newTag) return md;

  return md.replace(
    line,
    `[Unreleased]: ${compareBase}${newTag}...HEAD\n[${version}]: ${compareBase}${prevTag}...${newTag}`,
  );
}

/**
 * Validate and (if needed) promote the `[Unreleased]` section to `version`.
 *
 * Pure: takes the changelog text, returns the outcome. No I/O.
 */
export function promoteChangelog(
  md: string,
  version: string,
  date: string,
): ChangelogResult {
  const escaped = escapeForRegExp(version);
  if (new RegExp(`^##\\s*\\[${escaped}\\]`, "m").test(md)) {
    return {
      status: "present",
      content: md,
      message: `CHANGELOG: entry for ${version} already present.`,
    };
  }

  const heading = UNRELEASED.exec(md);
  if (heading === null) {
    return {
      status: "missing",
      message: `CHANGELOG.md has no "## [Unreleased]" section and no "## [${version}]" entry. Add an entry before releasing.`,
    };
  }

  // Body = everything between the [Unreleased] heading and the next "## [" heading.
  const rest = md.slice(heading.index + heading[0].length);
  const nextHeading = rest.search(/^##\s+\[/m);
  const body = nextHeading === -1 ? rest : rest.slice(0, nextHeading);

  // A real entry is a non-blank line that is not itself a heading (### Fixed, etc.).
  const hasEntry = body.split("\n").some((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("#");
  });
  if (!hasEntry) {
    return {
      status: "missing",
      message: `CHANGELOG.md "## [Unreleased]" has no entries. Document what ${version} ships before releasing.`,
    };
  }

  const stamped = md.replace(UNRELEASED, `## [Unreleased]\n\n## [${version}] — ${date}`);
  return {
    status: "promoted",
    content: updateLinkRefs(stamped, version),
    message: `CHANGELOG: promoted [Unreleased] to [${version}] — ${date}.`,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const checkOnly = argv[0] === "--check";
  const args = checkOnly ? argv.slice(1) : argv;

  const version = args[0];
  if (version === undefined || version === "") {
    console.error("changelog-release: missing <version> argument");
    process.exit(2);
  }

  const date = args[1] ?? new Date().toISOString().slice(0, 10);
  const path = process.env["CHANGELOG_PATH"] ?? "CHANGELOG.md";

  const result = promoteChangelog(readFileSync(path, "utf8"), version, date);

  // --check: report only. Never writes, never fails — the caller branches on the
  // status so a merge that documented nothing can skip the release cleanly.
  if (checkOnly) {
    console.log(result.status);
    process.exit(0);
  }

  if (result.status === "missing") {
    console.error(`[mcp-http] ${result.message}`);
    process.exit(1);
  }
  if (result.status === "promoted" && result.content !== undefined) {
    writeFileSync(path, result.content);
  }
  console.log(`[mcp-http] ${result.message}`);
}
