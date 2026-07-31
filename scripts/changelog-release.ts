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

/** Escape a version string for safe embedding in a RegExp. */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

  const content = md.replace(UNRELEASED, `## [Unreleased]\n\n## [${version}] — ${date}`);
  return {
    status: "promoted",
    content,
    message: `CHANGELOG: promoted [Unreleased] to [${version}] — ${date}.`,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const version = process.argv[2];
  if (version === undefined || version === "") {
    console.error("changelog-release: missing <version> argument");
    process.exit(2);
  }

  const date = process.argv[3] ?? new Date().toISOString().slice(0, 10);
  const path = process.env["CHANGELOG_PATH"] ?? "CHANGELOG.md";

  const result = promoteChangelog(readFileSync(path, "utf8"), version, date);

  if (result.status === "missing") {
    console.error(`[mcp-http] ${result.message}`);
    process.exit(1);
  }
  if (result.status === "promoted" && result.content !== undefined) {
    writeFileSync(path, result.content);
  }
  console.log(`[mcp-http] ${result.message}`);
}
