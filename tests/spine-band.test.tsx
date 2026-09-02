import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CommitSpine, SpineEntry } from "../src/shared/api.ts";
import { SpineBand } from "../src/web/components/SpineBand.tsx";

function entry(sha: string, parent: string, url: string | null, body = ""): SpineEntry {
  return {
    kind: "commit",
    sha,
    shortSha: sha.slice(0, 7),
    parent,
    subject: `work on ${sha}`,
    body,
    url,
    author: "Test",
    authorEmail: "test@example.com",
    date: "2026-01-01T00:00:00Z",
    files: 1,
    addedTokens: 40,
    removedTokens: 8,
    addedLines: 10,
    removedLines: 2,
    addedCodeLines: 10,
    removedCodeLines: 2,
  };
}

const spine: CommitSpine = {
  range: { kind: "revisionPair", base: "base0", target: "head" },
  commits: [
    entry("1a2b3c4d5e6f7a8b", "base0", "https://example.com/repo/commit/1a2b3c4d5e6f7a8b", "Why it happened."),
    entry("9f8e7d6c5b4a3928", "1a2b3c4d5e6f7a8b", null),
  ],
  omitted: 0,
};

function band(): string {
  return renderToStaticMarkup(
    <SpineBand
      spine={spine}
      measure="lines"
      request={spine.range}
      disabled={false}
      expanded
      onExpandedChange={() => undefined}
      onSelect={() => undefined}
      height={200}
      onHeightChange={() => undefined}
    />,
  );
}

describe("the object name in an expanded band", () => {
  it("copies the full name from the short one it draws", () => {
    const html = band();

    expect(html).toContain('aria-label="Copy the commit hash 1a2b3c4d5e6f7a8b"');
    expect(html).toContain('aria-label="Copy the commit hash 9f8e7d6c5b4a3928"');
    expect(html).toContain(">1a2b3c4<");
  });

  it("states what a figure column counts, in the measure the band is drawn in", () => {
    const html = band();

    expect(html).toContain("This column counts added lines in the whole commit.");
    expect(html).toContain("Net is added minus removed.");
    expect(html).toContain("Generated files are always left out.");
  });

  it("names the host the commit link opens, and links only where there is one", () => {
    const html = band();

    expect(html).toContain('href="https://example.com/repo/commit/1a2b3c4d5e6f7a8b"');
    expect(html).toContain("Open this commit on example.com");
    expect(html.match(/spine-row__forge/g)).toHaveLength(1);
  });

  it("says who a commit is by, and what each part of its message is", () => {
    const html = band();

    expect(html).toContain("Summary");
    expect(html).toContain("Description");
    expect(html).toContain("Why it happened.");
    expect(html).toContain("test@example.com");
  });
});
