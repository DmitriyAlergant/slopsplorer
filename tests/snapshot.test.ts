import { execFile } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanSourceTree } from "../src/scanner/scan.ts";
import { openDiffAligner, scanDiff, type DiffScanOptions } from "../src/scanner/diffScan.ts";
import { resolveComparison } from "../src/scanner/gitdiff.ts";
import { STATIC_EXPORT_MARKER } from "../src/scanner/walk.ts";
import { buildView, parseViewRequest } from "../src/server/aggregate.ts";
import { prepareStaticBundleOutput, writeStaticBundle } from "../src/server/export.ts";
import { readIndexedSource } from "../src/server/source.ts";
import { hydrateScanIndex, serializeScanIndex, type ScanIndex } from "../src/shared/index.ts";
import { ASPECTS, MEASURES, type SnapshotSourceRecord, type SourceResponse } from "../src/shared/api.ts";

const SCAN_TIMEOUT_MS = 60_000;
const execFileAsync = promisify(execFile);

describe("a static scan index", () => {
  let root: string;
  let index: ScanIndex;
  let diffRoot: string;
  let diffOptions: DiffScanOptions;
  let diffIndex: ScanIndex;

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-snapshot-"));
    await mkdir(path.join(root, "src"));
    await mkdir(path.join(root, "tests"));
    await writeFile(path.join(root, "src", "main.ts"), "export function main(): number { return 1; }\n", "utf8");
    await writeFile(path.join(root, "src", "generated.ts"), "// generated file\nexport const value = 2;\n", "utf8");
    await writeFile(path.join(root, "tests", "main.test.ts"), "export const tested = true;\n", "utf8");
    index = await scanSourceTree({
      root,
      tokenizer: "cl100k_base",
      allFiles: true,
      exclude: [],
      maxFileBytes: 2 * 1024 * 1024,
      concurrency: 2,
    });

    diffRoot = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-snapshot-diff-"));
    await execFileAsync("git", ["init", "-q", "-b", "main"], { cwd: diffRoot });
    await writeFile(path.join(diffRoot, "main.ts"), "export const value = 1;\n", "utf8");
    await execFileAsync("git", ["add", "main.ts"], { cwd: diffRoot });
    await execFileAsync(
      "git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--no-gpg-sign", "-qm", "base"],
      { cwd: diffRoot },
    );
    await writeFile(path.join(diffRoot, "main.ts"), "export const value = 20;\nexport const added = true;\n", "utf8");
    const comparison = await resolveComparison(diffRoot, { kind: "workingTree" });
    diffOptions = {
      root: diffRoot,
      comparison,
      tokenizer: "cl100k_base",
      exclude: [],
      maxFileBytes: 2 * 1024 * 1024,
      concurrency: 2,
    };
    diffIndex = await scanDiff(diffOptions);
  }, SCAN_TIMEOUT_MS);

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(diffRoot, { recursive: true, force: true });
  });

  it("preserves every measure and aspect of a comparison", () => {
    const published = serializeScanIndex(diffIndex, diffIndex.meta.rootName);
    const hydrated = hydrateScanIndex(JSON.parse(JSON.stringify(published)));
    for (const measure of MEASURES) {
      for (const aspect of ASPECTS) {
        const request = parseViewRequest({
          kinds: ["code", "test", "text", "i18n", "data", "other"],
          measure,
          aspect,
          rank: { metric: aspect, minWeight: 0, limit: 100, offset: 0 },
          expanded: [""],
        });
        expect(buildView(hydrated, request)).toEqual({ ...buildView(diffIndex, request), meta: published.meta });
      }
    }
  });

  it("hydrates the exact queryable index the scanner built", () => {
    const published = serializeScanIndex(index, index.meta.rootName);
    const hydrated = hydrateScanIndex(JSON.parse(JSON.stringify(published)));
    const requests = [
      parseViewRequest({ kinds: ["code", "test", "text", "i18n", "data", "other"], expanded: [""] }),
      parseViewRequest({ kinds: ["code"], query: "main", expanded: ["", "src"], selected: { path: "src" } }),
      parseViewRequest({
        kinds: ["code", "test"], showGenerated: true, measure: "lines", treeSort: "weight",
        drillPath: "src", selected: { rowKind: "files", path: "src" }, fileScope: "folder",
        excludedDirectFiles: ["tests"], rank: { metric: "name", minWeight: 0, limit: 10, offset: 0 },
      }),
    ];

    expect(published.meta.rootPath).toBe(index.meta.rootName);
    for (const request of requests) {
      expect(buildView(hydrated, request)).toEqual({ ...buildView(index, request), meta: published.meta });
    }
  });

  it("writes a static explorer with one lazy preview per file", async () => {
    const clientRoot = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-client-"));
    const output = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-site-"));
    try {
      if (process.platform !== "win32") await chmod(output, 0o751);
      await writeFile(path.join(clientRoot, "index.html"), "live", "utf8");
      await writeFile(
        path.join(clientRoot, "snapshot.html"),
        '<script id="slopsplorer-snapshot-context" type="application/json">__SLOPSPLORER_SNAPSHOT_CONTEXT__</script>',
        "utf8",
      );
      await mkdir(path.join(clientRoot, "assets"));
      await writeFile(path.join(clientRoot, "assets", "app.js"), "export {};", "utf8");

      await writeStaticBundle({
        clientRoot,
        output,
        index,
        producer: { kind: "scan", root },
        spine: null,
        concurrency: 2,
        backlink: {
          label: "PR #12",
          url: "https://github.com/owner/repo/pull/12",
        },
        reproductionCommand: "npx slopsplorer --pr 12",
      });

      expect(await readFile(path.join(output, "index.html"), "utf8")).toContain(
        '{"backlink":{"label":"PR #12","url":"https://github.com/owner/repo/pull/12"},'
        + '"reproductionCommand":"npx slopsplorer --pr 12"}',
      );
      await expect(readFile(path.join(output, STATIC_EXPORT_MARKER), "utf8")).resolves.toBe("");
      await expect(readFile(path.join(output, "snapshot.html"), "utf8")).rejects.toThrow();
      if (process.platform !== "win32") expect((await stat(output)).mode & 0o777).toBe(0o751);

      const serialized = JSON.parse(await readFile(path.join(output, "data", "index.json"), "utf8")) as {
        meta: { rootPath: string };
      };
      expect(serialized.meta.rootPath).toBe(index.meta.rootName);
      await expect(readFile(path.join(output, "data", "spine.json"), "utf8")).resolves.toBe("null\n");

      for (const [fileIndex, file] of index.files.entries()) {
        const source = JSON.parse(
          await readFile(path.join(output, "data", "sources", `${fileIndex}.json`), "utf8"),
        ) as SourceResponse;
        expect(source).toMatchObject({ mode: "source", path: file.path, truncated: false });
      }
    } finally {
      await rm(clientRoot, { recursive: true, force: true });
      await rm(output, { recursive: true, force: true });
    }
  });

  it("exports a comparison with previews aligned by the one producer", async () => {
    const clientRoot = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-client-"));
    const output = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-site-"));
    try {
      await writeFile(path.join(clientRoot, "index.html"), "live", "utf8");
      await writeFile(
        path.join(clientRoot, "snapshot.html"),
        '<script id="slopsplorer-snapshot-context" type="application/json">__SLOPSPLORER_SNAPSHOT_CONTEXT__</script>',
        "utf8",
      );
      await writeStaticBundle({
        clientRoot,
        output,
        index: diffIndex,
        producer: { kind: "diff", options: diffOptions },
        spine: null,
        concurrency: 2,
        backlink: null,
        reproductionCommand: "npx slopsplorer --diff",
      });

      const fileIndex = diffIndex.fileIndexByPath.get("main.ts");
      const source = JSON.parse(
        await readFile(path.join(output, "data", "sources", `${fileIndex}.json`), "utf8"),
      ) as SourceResponse;
      expect(source.mode).toBe("diff");
      expect(source.path).toBe("main.ts");
      if (source.mode === "diff") {
        expect(source.lines.some((line) => line.marker === "+")).toBe(true);
        expect(source.lines.some((line) => line.marker === "-")).toBe(true);
      }
    } finally {
      await rm(clientRoot, { recursive: true, force: true });
      await rm(output, { recursive: true, force: true });
    }
  });

  it("refuses a worktree diff preview that resolves outside the repository", async () => {
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-diff-outside-"));
    const clientRoot = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-client-"));
    const output = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-site-"));
    const escapePath = path.join(diffRoot, "escape.ts");
    try {
      await writeFile(path.join(outsideRoot, "secret.ts"), "export const secret = true;\n", "utf8");
      await symlink(path.join(outsideRoot, "secret.ts"), escapePath);
      const comparison = await resolveComparison(diffRoot, { kind: "workingTree" });
      const options: DiffScanOptions = { ...diffOptions, comparison };
      const escapingIndex = await scanDiff(options);
      expect(escapingIndex.fileIndexByPath.has("escape.ts")).toBe(true);

      await writeFile(
        path.join(clientRoot, "snapshot.html"),
        '<script id="slopsplorer-snapshot-context" type="application/json">__SLOPSPLORER_SNAPSHOT_CONTEXT__</script>',
        "utf8",
      );
      await writeStaticBundle({
        clientRoot,
        output,
        index: escapingIndex,
        producer: { kind: "diff", options },
        spine: null,
        concurrency: 2,
        backlink: null,
        reproductionCommand: "npx slopsplorer --diff",
      });

      const fileIndex = escapingIndex.fileIndexByPath.get("escape.ts");
      const record = JSON.parse(await readFile(
        path.join(output, "data", "sources", `${fileIndex}.json`), "utf8",
      )) as SnapshotSourceRecord;
      expect(record).toEqual({ error: "file resolves outside the scan root" });
    } finally {
      await rm(escapePath, { force: true });
      await rm(outsideRoot, { recursive: true, force: true });
      await rm(clientRoot, { recursive: true, force: true });
      await rm(output, { recursive: true, force: true });
    }
  });

  it("exports a refusal for a file it cannot read instead of stopping", async () => {
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-outside-"));
    const escapingRoot = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-escaping-"));
    const clientRoot = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-client-"));
    const output = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-site-"));
    try {
      await writeFile(path.join(outsideRoot, "secret.ts"), "export const secret = true;\n", "utf8");
      // Git lists a tracked or untracked symlink, and the scanner measures its
      // target, so the export meets the file the live route refuses.
      await execFileAsync("git", ["init", "-q"], { cwd: escapingRoot });
      await writeFile(path.join(escapingRoot, "ok.ts"), "export const ok = true;\n", "utf8");
      await symlink(path.join(outsideRoot, "secret.ts"), path.join(escapingRoot, "escape.ts"));
      const escapingIndex = await scanSourceTree({
        root: escapingRoot,
        tokenizer: "cl100k_base",
        allFiles: false,
        exclude: [],
        maxFileBytes: 2 * 1024 * 1024,
        concurrency: 2,
      });
      expect(escapingIndex.fileIndexByPath.has("escape.ts")).toBe(true);

      await writeFile(path.join(clientRoot, "index.html"), "live", "utf8");
      await writeFile(
        path.join(clientRoot, "snapshot.html"),
        '<script id="slopsplorer-snapshot-context" type="application/json">__SLOPSPLORER_SNAPSHOT_CONTEXT__</script>',
        "utf8",
      );
      await writeStaticBundle({
        clientRoot,
        output,
        index: escapingIndex,
        producer: { kind: "scan", root: escapingRoot },
        spine: null,
        concurrency: 2,
        backlink: null,
        reproductionCommand: "npx slopsplorer .",
      });

      const recordOf = async (filePath: string): Promise<SnapshotSourceRecord> => JSON.parse(await readFile(
        path.join(output, "data", "sources", `${escapingIndex.fileIndexByPath.get(filePath)}.json`), "utf8",
      )) as SnapshotSourceRecord;
      await expect(recordOf("escape.ts")).resolves.toEqual({ error: "file resolves outside the scan root" });
      await expect(recordOf("ok.ts")).resolves.toMatchObject({ mode: "source", path: "ok.ts" });
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
      await rm(escapingRoot, { recursive: true, force: true });
      await rm(clientRoot, { recursive: true, force: true });
      await rm(output, { recursive: true, force: true });
    }
  });

  it("exports a refusal when an indexed source becomes unreadable", async () => {
    const changingRoot = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-unreadable-"));
    const clientRoot = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-client-"));
    const output = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-site-"));
    const changingPath = path.join(changingRoot, "changing.ts");
    try {
      await writeFile(changingPath, "export const value = true;\n", "utf8");
      const changingIndex = await scanSourceTree({
        root: changingRoot,
        tokenizer: "cl100k_base",
        allFiles: true,
        exclude: [],
        maxFileBytes: 2 * 1024 * 1024,
        concurrency: 2,
      });
      await rm(changingPath);
      await mkdir(changingPath);
      await writeFile(
        path.join(clientRoot, "snapshot.html"),
        '<script id="slopsplorer-snapshot-context" type="application/json">__SLOPSPLORER_SNAPSHOT_CONTEXT__</script>',
        "utf8",
      );

      await writeStaticBundle({
        clientRoot,
        output,
        index: changingIndex,
        producer: { kind: "scan", root: changingRoot },
        spine: null,
        concurrency: 2,
        backlink: null,
        reproductionCommand: "npx slopsplorer .",
      });

      const record = JSON.parse(await readFile(
        path.join(output, "data", "sources", "0.json"), "utf8",
      )) as SnapshotSourceRecord;
      expect(record).toEqual({ error: "file is no longer readable" });
    } finally {
      await rm(changingRoot, { recursive: true, force: true });
      await rm(clientRoot, { recursive: true, force: true });
      await rm(output, { recursive: true, force: true });
    }
  });

  it("reads a worktree diff from the path that passed the root check", async () => {
    const changingRoot = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-diff-symlink-"));
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-diff-secret-"));
    const linkPath = path.join(changingRoot, "link.ts");
    try {
      await execFileAsync("git", ["init", "-q", "-b", "main"], { cwd: changingRoot });
      await writeFile(path.join(changingRoot, "inside.ts"), "export const inside = true;\n", "utf8");
      await execFileAsync("git", ["add", "inside.ts"], { cwd: changingRoot });
      await execFileAsync(
        "git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--no-gpg-sign", "-qm", "base"],
        { cwd: changingRoot },
      );
      await symlink("inside.ts", linkPath);
      const comparison = await resolveComparison(changingRoot, { kind: "workingTree" });
      const options: DiffScanOptions = {
        ...diffOptions,
        root: changingRoot,
        comparison,
      };
      const changingIndex = await scanDiff(options);
      const row = changingIndex.files[changingIndex.fileIndexByPath.get("link.ts")!];
      expect(row).toBeDefined();
      const checkedPath = await realpath(linkPath);
      const aligner = await openDiffAligner(options, [row!]);
      try {
        await writeFile(path.join(outsideRoot, "secret.ts"), "export const secret = true;\n", "utf8");
        await rm(linkPath);
        await symlink(path.join(outsideRoot, "secret.ts"), linkPath);

        const aligned = await aligner.align(row!, checkedPath);
        expect(aligned?.map((line) => line.text).join("\n")).toContain("inside = true");
        expect(aligned?.map((line) => line.text).join("\n")).not.toContain("secret = true");
      } finally {
        aligner.dispose();
      }
    } finally {
      await rm(changingRoot, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  }, SCAN_TIMEOUT_MS);

  it("reads an accepted file whose name starts with two dots", async () => {
    const dottedRoot = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-dotted-source-"));
    try {
      await writeFile(path.join(dottedRoot, "..valid.ts"), "export const valid = true;\n", "utf8");
      const dottedIndex = await scanSourceTree({
        root: dottedRoot,
        tokenizer: "cl100k_base",
        allFiles: true,
        exclude: [],
        maxFileBytes: 2 * 1024 * 1024,
        concurrency: 2,
      });

      await expect(readIndexedSource(
        dottedIndex,
        { kind: "scan", root: dottedRoot },
        "..valid.ts",
      )).resolves.toMatchObject({ mode: "source", content: "export const valid = true;\n" });
    } finally {
      await rm(dottedRoot, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite a non-empty output directory", async () => {
    const clientRoot = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-client-"));
    const output = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-site-"));
    try {
      await writeFile(path.join(output, "keep.txt"), "mine\n", "utf8");
      await expect(writeStaticBundle({
        clientRoot,
        output,
        index,
        producer: { kind: "scan", root },
        spine: null,
        concurrency: 2,
        backlink: null,
        reproductionCommand: "npx slopsplorer .",
      })).rejects.toThrow(/not empty/);
      await expect(readFile(path.join(output, "keep.txt"), "utf8")).resolves.toBe("mine\n");
    } finally {
      await rm(clientRoot, { recursive: true, force: true });
      await rm(output, { recursive: true, force: true });
    }
  });

  it("leaves an empty destination after a failed write, so the export can be retried", async () => {
    const clientRoot = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-client-"));
    const output = path.join(await mkdtemp(path.join(os.tmpdir(), "slopsplorer-site-parent-")), "site");
    try {
      await writeFile(path.join(clientRoot, "snapshot.html"), "missing snapshot context", "utf8");
      await expect(writeStaticBundle({
        clientRoot,
        output,
        index,
        producer: { kind: "scan", root },
        spine: null,
        concurrency: 2,
        backlink: null,
        reproductionCommand: "npx slopsplorer .",
      })).rejects.toThrow(/context placeholder/);

      await expect(readFile(path.join(output, "snapshot.html"), "utf8")).rejects.toThrow();
      await expect(prepareStaticBundleOutput(output)).resolves.toBeUndefined();
    } finally {
      await rm(clientRoot, { recursive: true, force: true });
      await rm(path.dirname(output), { recursive: true, force: true });
    }
  });
}, SCAN_TIMEOUT_MS);

describe("the snapshot entry document", () => {
  const entry = path.join(import.meta.dirname, "..", "src", "web", "snapshot.html");

  /**
   * The guard runs as a classic inline script, which is the one thing a file://
   * document still executes. It is read out of the shipped entry and driven here,
   * so a rewrite of that document cannot leave the notice unreachable.
   */
  async function revealNoticeAt(protocol: string): Promise<boolean> {
    const html = await readFile(entry, "utf8");
    const guard = /<script>([\s\S]*?)<\/script>/.exec(html);
    if (guard === null) throw new Error("the snapshot entry holds no inline guard script");
    const notice = { hidden: true };
    const document = {
      querySelector: (selector: string) => selector === "#slopsplorer-file-url-notice" ? notice : null,
    };
    new Function("location", "document", guard[1] as string)({ protocol }, document);
    return !notice.hidden;
  }

  it("tells a reader who opened it from a file path that it needs a server", async () => {
    const html = await readFile(entry, "utf8");
    expect(html.indexOf("slopsplorer-file-url-notice")).toBeGreaterThan(html.indexOf('<div id="root">'));
    expect(html).toContain("needs an HTTP server");
    await expect(revealNoticeAt("file:")).resolves.toBe(true);
  });

  it("keeps the notice hidden when the bundle is served, so the page draws alone", async () => {
    await expect(revealNoticeAt("http:")).resolves.toBe(false);
    await expect(revealNoticeAt("https:")).resolves.toBe(false);
  });
});
