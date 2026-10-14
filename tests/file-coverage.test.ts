import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { scanDiff } from "../src/scanner/diffScan.ts";
import { resolveComparison } from "../src/scanner/gitdiff.ts";
import { scanReviewSide, scanSourceTree, type ScanIndex } from "../src/scanner/scan.ts";
import { buildFileList, buildView, parseViewRequest } from "../src/server/aggregate.ts";
import { buildReport } from "../src/server/report.ts";
import { hydrateScanIndex, serializeScanIndex } from "../src/shared/index.ts";
import { readIndexedSource } from "../src/server/source.ts";

let root: string;
let index: ScanIndex;
const options = { tokenizer: "cl100k_base" as const, exclude: ["excluded"], maxFileBytes: 1024, concurrency: 4 };
function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}
async function write(name: string, content: string | Buffer): Promise<void> {
  await mkdir(path.dirname(path.join(root, name)), { recursive: true });
  await writeFile(path.join(root, name), content);
}
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-coverage-"));
  git("init", "-q", "-b", "main");
  await write("old-name", "retained text\n");
  await write("executable", "#!/bin/sh\necho ok\n");
  git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--no-gpg-sign", "-qm", "base");
  await rename(path.join(root, "old-name"), path.join(root, "new-name"));
  await chmod(path.join(root, "executable"), 0o755);
  await write("apps/controltower/Dockerfile", "# Build\nFROM node\n");
  await write("apps/test-runner/Containerfile.dev", "# Build\nFROM node\n");
  await write("fix.patch", "--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new\n");
  await write("fix.diff", "--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new\n");
  await write("pnpm-lock.yaml", "lockfileVersion: 9\n");
  await write("unknown.custom", "custom source\n");
  await write("vendor/maintained.custom", "tracked source\n");
  await write("binary/image.ts", Buffer.from([0, 1, 2, 3]));
  await write("large/payload.txt", "x".repeat(2048));
  await write("excluded/secret.txt", "excluded text\n");
  await write("utf16.txt", Buffer.concat([Buffer.from([255, 254]), Buffer.from("hello\n", "utf16le")]));
  await write("legacy.txt", Buffer.from([0x63, 0x61, 0x66, 0xe9]));
  await write("empty", "");
  git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--no-gpg-sign", "-qm", "change");
  const comparison = await resolveComparison(root, { kind: "revisionPair", base: "HEAD~1", target: "HEAD" });
  index = await scanDiff({ ...options, root, comparison });
}, 60_000);
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

it("accounts for every changed path, including zero-churn and unmeasured files", () => {
  const names = git("diff", "--name-only", "-M", "HEAD~1", "HEAD").trim().split("\n").sort();
  expect(index.files.map((file) => file.path)).toEqual(names);
  expect(index.files.find((file) => file.path === "binary/image.ts")).toMatchObject({ measurement: "binary", tokens: null });
  expect(index.files.find((file) => file.path === "large/payload.txt")).toMatchObject({ measurement: "too-large", lines: null });
  expect(index.files.find((file) => file.path === "excluded/secret.txt")).toMatchObject({ measurement: "excluded" });
  expect(index.files.find((file) => file.path === "legacy.txt")).toMatchObject({ measurement: "unsupported-encoding" });
  expect(index.files.find((file) => file.path === "new-name")).toMatchObject({ measurement: "measured", status: "renamed", churnLines: 0 });
  expect(index.files.find((file) => file.path === "executable")).toMatchObject({ measurement: "measured", churnLines: 0 });
});

it("measures text without an extension allow list and preserves explicit flavors", () => {
  for (const name of ["fix.patch", "fix.diff", "unknown.custom", "vendor/maintained.custom"]) {
    expect(index.files.find((file) => file.path === name)).toMatchObject({ measurement: "measured", kind: "code", generated: false });
  }
  for (const name of ["apps/controltower/Dockerfile", "apps/test-runner/Containerfile.dev"]) {
    expect(index.files.find((file) => file.path === name)).toMatchObject({ codeLines: 1, commentLines: 1 });
  }
  expect(index.files.find((file) => file.path === "utf16.txt")).toMatchObject({ lines: 1 });
});

it("hides disabled flavors while retaining unmeasured paths in enabled flavors", () => {
  const request = parseViewRequest({ kinds: ["code", "test", "text", "data", "i18n", "other"], expanded: ["", "binary"], fileScope: "subtree", rank: { metric: "name", limit: 100 } });
  const view = buildView(index, request);
  expect(view.ranked).toHaveLength(index.files.length - 1);
  expect(view.tree.some((row) => row.path === "binary")).toBe(true);
  expect(view.detail.availableFiles).toBe(index.files.length);
  expect(view.detail.unmeasuredFiles).toBe(4);
  expect(view.detail.shownFiles).toBe(index.files.length - 5);
  expect(view.ranked.some((file) => file.path === "pnpm-lock.yaml")).toBe(false);
  expect(buildFileList(index, request).rows.map((file) => file.path).sort()).toEqual(view.ranked.map((file) => file.path).sort());
  const all = { ...request, showGenerated: true };
  expect(buildView(index, all).ranked).toHaveLength(index.files.length);
  expect(buildFileList(index, all).rows).toHaveLength(index.files.length);
  const none = { ...request, kinds: [] };
  expect(buildView(index, none).ranked).toEqual([]);
  expect(buildFileList(index, none).rows).toEqual([]);
});

it("uses the same content detection in scans and source previews", async () => {
  const scanned = await scanSourceTree({ ...options, root, allFiles: false });
  expect(scanned.files.find((file) => file.path === "binary/image.ts")).toMatchObject({ measurement: "binary" });
  expect(scanned.files.find((file) => file.path === "vendor/maintained.custom")).toMatchObject({ measurement: "measured" });
  const source = await readIndexedSource(scanned, { kind: "scan", root }, "utf16.txt");
  expect(source).toMatchObject({ mode: "source", content: "hello\n" });
  const binary = await readIndexedSource(scanned, { kind: "scan", root }, "binary/image.ts");
  expect(binary).toMatchObject({ mode: "unmeasured", reason: "binary" });
}, 60_000);

it("measures the seven-file PR as +84/-23, with +57 net when generated files are excluded", async () => {
  const exampleRoot = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-seven-files-"));
  const exampleGit = (...args: string[]): string => execFileSync("git", args, { cwd: exampleRoot, encoding: "utf8" });
  const exampleWrite = async (name: string, text: string): Promise<void> => {
    await mkdir(path.dirname(path.join(exampleRoot, name)), { recursive: true });
    await writeFile(path.join(exampleRoot, name), text);
  };
  const commit = (): void => {
    exampleGit("add", ".");
    exampleGit("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--no-gpg-sign", "-qm", "fixture");
  };
  const lines = (prefix: string, count: number): string => Array.from({ length: count }, (_, position) => `${prefix}${position}\n`).join("");
  try {
    exampleGit("init", "-q", "-b", "main");
    await exampleWrite("pnpm-lock.yaml", lines("old: ", 23));
    commit();
    await exampleWrite("pnpm-lock.yaml", lines("new: ", 27));
    await exampleWrite("pnpm-workspace.yaml", lines("workspace: ", 3));
    await exampleWrite("changelog.d/auth.change.md", "Fix authentication.\n");
    await exampleWrite("apps/controltower/Dockerfile", "FROM node\n");
    await exampleWrite("apps/test-runner/Dockerfile", "FROM node\n");
    await exampleWrite("@better-auth__core@1.6.24.patch", lines("+fix ", 30));
    await exampleWrite("@better-auth__oauth-provider@1.6.24.patch", lines("+fix ", 21));
    commit();
    const comparison = await resolveComparison(exampleRoot, { kind: "revisionPair", base: "HEAD~1", target: "HEAD" });
    const example = await scanDiff({ ...options, exclude: [], root: exampleRoot, comparison });
    expect(example.files).toHaveLength(7);
    expect(example.files.every((file) => file.measurement === "measured")).toBe(true);
    const request = parseViewRequest({ kinds: ["code", "text", "data", "other", "test", "i18n"], measure: "lines", aspect: "net" });
    const included = buildView(example, request);
    expect(included.detail).toMatchObject({ availableFiles: 7, shownFiles: 6, generatedFiles: 1, unmeasuredFiles: 0, added: 57, removed: 0, weight: 57 });
    expect(included.ranked).toHaveLength(6);
    const all = buildView(example, { ...request, showGenerated: true });
    expect(all.detail).toMatchObject({ added: 84, removed: 23, weight: 61 });
    expect(all.ranked).toHaveLength(7);
  } finally {
    await rm(exampleRoot, { recursive: true, force: true });
  }
}, 60_000);


it("preserves unmeasured outcomes in reports and serialized snapshots", () => {
  const report = buildReport(index, { measure: "lines", aspect: "net", threshold: 100 });
  expect(report).toContain("15 files, 11 measured, 1 generated, 4 not measured");
  for (const reason of [
    "binary/image.ts: Binary", "excluded/secret.txt: Excluded from scan",
    "large/payload.txt: Over size limit", "legacy.txt: Unsupported encoding",
  ]) expect(report).toContain(reason);
  const request = parseViewRequest({ kinds: ["code", "text", "data"] });
  const restored = hydrateScanIndex(JSON.parse(JSON.stringify(serializeScanIndex(index, root))));
  expect(buildView(restored, request)).toEqual(buildView(index, request));
});

it("does not measure link targets or submodule commit objects in any repository image", async () => {
  const specialRoot = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-links-"));
  const specialGit = (...args: string[]): string => execFileSync("git", args, { cwd: specialRoot, encoding: "utf8" });
  const commit = (): void => {
    specialGit("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--no-gpg-sign", "-qm", "fixture");
  };
  try {
    specialGit("init", "-q", "-b", "main");
    await writeFile(path.join(specialRoot, "source"), "measured content\n");
    specialGit("add", ".");
    commit();
    const base = specialGit("rev-parse", "HEAD").trim();
    await symlink("source", path.join(specialRoot, "link"));
    specialGit("add", "link");
    specialGit("update-index", "--add", "--cacheinfo", `160000,${base},module`);
    commit();
    const comparison = await resolveComparison(specialRoot, { kind: "revisionPair", base: "HEAD~1", target: "HEAD" });
    const changed = await scanDiff({ ...options, root: specialRoot, comparison });
    expect(changed.files).toMatchObject([
      { path: "link", measurement: "symlink", tokens: null },
      { path: "module", measurement: "submodule", tokens: null },
    ]);
    for (const target of [{ kind: "revision", rev: "HEAD" } as const, { kind: "index" } as const]) {
      const reviewed = await scanReviewSide({ ...options, root: specialRoot, comparison: { ...comparison, target }, side: "after" });
      expect(reviewed.files.find((file) => file.path === "link")?.measurement).toBe("symlink");
      expect(reviewed.files.find((file) => file.path === "module")?.measurement).toBe("submodule");
      expect(reviewed.files.find((file) => file.path === "source")?.measurement).toBe("measured");
    }
  } finally {
    await rm(specialRoot, { recursive: true, force: true });
  }
}, 60_000);

it("fails a scan when its root cannot be listed instead of reporting an empty tree", async () => {
  await expect(scanSourceTree({ ...options, root: path.join(root, "missing-root"), allFiles: true })).rejects.toMatchObject({ code: "ENOENT" });
});
