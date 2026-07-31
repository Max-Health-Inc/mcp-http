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
