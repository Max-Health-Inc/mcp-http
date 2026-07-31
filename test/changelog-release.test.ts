/**
 * Release-time changelog gate. The pure core is tested here; the CLI wrapper in
 * scripts/changelog-release.ts just does the fs + process.exit around it.
 */
import { describe, it, expect } from "bun:test";
import { promoteChangelog } from "../scripts/changelog-release.js";

const base = (unreleasedBody: string): string => `# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]
${unreleasedBody}## [0.1.6] — 2026-05-31

### Fixed

- something old
`;

describe("promoteChangelog", () => {
  it("promotes an Unreleased section that has entries", () => {
    const md = base("\n### Fixed\n\n- new thing\n\n");
    const result = promoteChangelog(md, "0.1.7", "2026-07-31");

    expect(result.status).toBe("promoted");
    const out = result.content ?? "";
    expect(out).toContain("## [0.1.7] — 2026-07-31");
    // a fresh empty [Unreleased] stays above the stamped version
    expect(out.indexOf("## [Unreleased]")).toBeLessThan(out.indexOf("## [0.1.7]"));
    // the entry moved under the new version, above the previous release
    expect(out.indexOf("- new thing")).toBeLessThan(out.indexOf("## [0.1.6]"));
  });

  it("fails when Unreleased is empty", () => {
    expect(promoteChangelog(base("\n"), "0.1.7", "2026-07-31").status).toBe("missing");
  });

  it("fails when Unreleased has only sub-headings, no entries", () => {
    expect(promoteChangelog(base("\n### Fixed\n\n"), "0.1.7", "2026-07-31").status).toBe(
      "missing",
    );
  });

  it("is a no-op when the version entry already exists", () => {
    const md = base("\n- new thing\n\n");
    const result = promoteChangelog(md, "0.1.6", "2026-07-31");

    expect(result.status).toBe("present");
    expect(result.content).toBe(md);
  });

  it("fails when there is neither an Unreleased section nor the version", () => {
    const md = "# Changelog\n\n## [0.1.6] — 2026-05-31\n\n- old\n";
    expect(promoteChangelog(md, "0.1.7", "2026-07-31").status).toBe("missing");
  });

  it("escapes regex metacharacters in the version", () => {
    const md = base("\n- new thing\n\n");
    // "0.1.6" must not be matched by a naive pattern where "." is a wildcard.
    expect(promoteChangelog(md, "0x1x6", "2026-07-31").status).toBe("promoted");
  });

  it("returns a message describing the outcome", () => {
    const md = base("\n- new thing\n\n");
    expect(promoteChangelog(md, "0.1.7", "2026-07-31").message).toContain("0.1.7");
  });
});

// ---------------------------------------------------------------------------
// Link references
// ---------------------------------------------------------------------------

const REPO = "https://github.com/Max-Health-Inc/mcp-http";

const withLinks = (unreleasedBody: string): string =>
  `${base(unreleasedBody)}
[Unreleased]: ${REPO}/compare/v0.1.6...HEAD
[0.1.6]: ${REPO}/compare/v0.1.5...v0.1.6
`;

describe("promoteChangelog — link references", () => {
  it("repoints [Unreleased] at the new tag and adds the version's compare link", () => {
    const result = promoteChangelog(
      withLinks("\n- new thing\n\n"),
      "0.2.0",
      "2026-07-31",
    );
    const out = result.content ?? "";

    expect(out).toContain(`[Unreleased]: ${REPO}/compare/v0.2.0...HEAD`);
    expect(out).toContain(`[0.2.0]: ${REPO}/compare/v0.1.6...v0.2.0`);
    // the previous release's link survives
    expect(out).toContain(`[0.1.6]: ${REPO}/compare/v0.1.5...v0.1.6`);
  });

  it("puts the new link directly beneath [Unreleased]", () => {
    const out =
      promoteChangelog(withLinks("\n- new thing\n\n"), "0.2.0", "2026-07-31").content ??
      "";
    expect(out.indexOf("[Unreleased]:")).toBeLessThan(out.indexOf("[0.2.0]:"));
    expect(out.indexOf("[0.2.0]:")).toBeLessThan(out.indexOf("[0.1.6]:"));
  });

  it("does not invent a link block when the changelog keeps none", () => {
    const out =
      promoteChangelog(base("\n- new thing\n\n"), "0.2.0", "2026-07-31").content ?? "";
    expect(out).not.toContain("[Unreleased]:");
    expect(out).not.toContain("[0.2.0]:");
  });

  it("derives the repository URL from the file rather than hardcoding it", () => {
    const other = withLinks("\n- new thing\n\n").replaceAll(
      REPO,
      "https://example.com/x",
    );
    const out = promoteChangelog(other, "0.2.0", "2026-07-31").content ?? "";
    expect(out).toContain("[0.2.0]: https://example.com/x/compare/v0.1.6...v0.2.0");
  });

  it("is idempotent when the links already point at this version", () => {
    const already = withLinks("\n- new thing\n\n").replace(
      "v0.1.6...HEAD",
      "v0.2.0...HEAD",
    );
    const out = promoteChangelog(already, "0.2.0", "2026-07-31").content ?? "";
    expect(out).toContain(`[Unreleased]: ${REPO}/compare/v0.2.0...HEAD`);
    // no self-referential v0.2.0...v0.2.0 link
    expect(out).not.toContain("v0.2.0...v0.2.0");
  });
});
