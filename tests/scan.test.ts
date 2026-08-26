import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanSourceTree, type ScanIndex } from "../src/scanner/scan.ts";
import { TOKENIZERS, type TokenizerName } from "../src/scanner/tokenize.ts";

const SCAN_TIMEOUT_MS = 60_000;

async function makeTree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-scan-"));
  for (const [relativePath, contents] of Object.entries(files)) {
    const absolute = path.join(root, relativePath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, contents, "utf8");
  }
  return root;
}

async function scan(
  root: string,
  allFiles: boolean,
  tokenizer: TokenizerName = "cl100k_base",
): Promise<ScanIndex> {
  return scanSourceTree({
    root,
    tokenizer,
    allFiles,
    exclude: [],
    maxFileBytes: 2 * 1024 * 1024,
    concurrency: 8,
  });
}

const PYTHON_STRUCTURE = `class Widget:
    def render(self, items):
        # Draw every item.
        for item in items:
            if item:
                return item
        return None


def build(count):
    try:
        return Widget()
    except ValueError:
        return None
`;

const PYTHON_DOCSTRING = `def helper():
    """Explain the helper.

    More detail here.
    """
    return 1
`;

const TYPESCRIPT_SOURCE = `export interface Options {
  verbose: boolean;
}

export function run(options: Options): number {
  // Decide the mode.
  if (options.verbose) {
    return 1;
  }
  return 0;
}

export const double = (value: number): number => value * 2;
`;

const MARKDOWN_SOURCE = `# Guide

Slopsplorer measures token weight, not code quality.

- One point
- Another point
`;

const FIXTURE = {
  "app/main.ts": TYPESCRIPT_SOURCE,
  "app-utils/helper.ts": "export const helper = 1;\n",
  "app.config.ts": "export default { port: 8765 };\n",
  "chainlit/service.py": PYTHON_STRUCTURE,
  "chainlit-datalayer/models.py": PYTHON_DOCSTRING,
  "docs/guide.md": MARKDOWN_SOURCE,
};

describe("scanning a source tree", () => {
  let root: string;
  let index: ScanIndex;

  beforeAll(async () => {
    root = await makeTree(FIXTURE);
    index = await scan(root, true);
  }, SCAN_TIMEOUT_MS);

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("measures every accepted file exactly once", () => {
    expect(index.files.map((file) => file.path)).toEqual([
      "app-utils/helper.ts",
      "app.config.ts",
      "app/main.ts",
      "chainlit-datalayer/models.py",
      "chainlit/service.py",
      "docs/guide.md",
    ]);
    expect(index.meta.fileCount).toBe(6);
  });

  it("keeps sibling folders whose names share a prefix as siblings instead of nesting one inside the other", () => {
    // Regression: a bare `startsWith` check made `chainlit-datalayer` look like
    // a child of `chainlit`, which moved its whole weight under the wrong parent.
    const root_ = index.folderByPath.get("");
    expect(root_?.childPaths).toEqual([
      "app", "app-utils", "chainlit", "chainlit-datalayer", "docs",
    ]);
    expect(index.folderByPath.get("chainlit")?.parentPath).toBe("");
    expect(index.folderByPath.get("chainlit")?.childPaths).toEqual([]);
    expect(index.folderByPath.get("chainlit-datalayer")?.parentPath).toBe("");
    expect(index.folderByPath.get("app")?.childPaths).toEqual([]);
    expect(index.folderByPath.get("app-utils")?.parentPath).toBe("");
  });

  it("gives every folder a contiguous range that bounds exactly its descendants and nothing else", () => {
    // `app/`, `app-utils/`, and `app.config.ts` sort around each other, so this
    // is where an off-by-one in the range boundary would show up.
    const paths = index.files.map((file) => file.path);
    for (const folder of index.folders) {
      const prefix = folder.path ? `${folder.path}/` : "";
      const inRange = paths.slice(folder.start, folder.end);
      const expected = paths.filter((filePath) => filePath.startsWith(prefix));
      expect(inRange, `range for folder "${folder.path}"`).toEqual(expected);
    }

    const app = index.folderByPath.get("app")!;
    expect(paths.slice(app.start, app.end)).toEqual(["app/main.ts"]);
    const appUtils = index.folderByPath.get("app-utils")!;
    expect(paths.slice(appUtils.start, appUtils.end)).toEqual(["app-utils/helper.ts"]);
    const chainlit = index.folderByPath.get("chainlit")!;
    expect(paths.slice(chainlit.start, chainlit.end)).toEqual(["chainlit/service.py"]);
  });

  it("counts Python functions, classes, and decision points from the grammar", () => {
    const file = index.files.find((row) => row.path === "chainlit/service.py")!;
    expect(file.language).toBe("python");
    expect(file.functions).toBe(2);
    expect(file.classes).toBe(1);
    expect(file.branches).toBe(3);
    expect(file.kind).toBe("code");
    expect(file.generated).toBe(false);
  });

  it("counts a Python docstring as commentary, because it carries the prose weight a block comment carries elsewhere", () => {
    const file = index.files.find((row) => row.path === "chainlit-datalayer/models.py")!;
    expect(file.language).toBe("python");
    expect(file.commentLines).toBe(3);
    expect(file.codeLines).toBe(2);
    expect(file.blankLines).toBe(1);
    expect(file.lines).toBe(file.codeLines + file.commentLines);
  });

  it("reports TypeScript structure, including arrow functions, under the typescript grammar", () => {
    const file = index.files.find((row) => row.path === "app/main.ts")!;
    expect(file.language).toBe("typescript");
    expect(file.functions).toBe(2);
    expect(file.classes).toBe(1);
    expect(file.branches).toBe(1);
    expect(file.commentLines).toBe(1);
  });

  it("still weighs a file whose format has no grammar, reporting zero structure rather than a guess", () => {
    const file = index.files.find((row) => row.path === "docs/guide.md")!;
    expect(file.language).toBeNull();
    expect(file.functions).toBe(0);
    expect(file.classes).toBe(0);
    expect(file.branches).toBe(0);
    expect(file.tokens).toBeGreaterThan(0);
    expect(file.lines).toBeGreaterThan(0);
    expect(file.kind).toBe("text");
  });

  it("records which grammars produced the structure numbers so the metadata explains the counts", () => {
    expect(index.meta.languages).toEqual(["python", "typescript"]);
    expect(index.meta.folderCount).toBe(index.folders.length);
  });

  it("measures tokenizer control-token spellings as ordinary source text", async () => {
    const specialTokenRoot = await makeTree({
      "special-token.txt": "A source fixture can contain <|endoftext|> literally.\n",
    });
    try {
      for (const tokenizer of TOKENIZERS) {
        const specialTokenIndex = await scan(specialTokenRoot, true, tokenizer);
        expect(specialTokenIndex.files).toHaveLength(1);
        expect(specialTokenIndex.files[0]?.tokens).toBeGreaterThan(0);
      }
    } finally {
      await rm(specialTokenRoot, { recursive: true, force: true });
    }
  });
});

describe("walking a plain folder that is not a Git worktree", () => {
  let root: string;

  beforeAll(async () => {
    root = await makeTree({
      ".gitignore": "ignored/\n",
      "kept.py": "value = 1\n",
      "ignored/thing.py": "value = 2\n",
    });
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("applies .gitignore itself, so build output outside Git does not distort the map", async () => {
    const index = await scan(root, false);
    expect(index.meta.gitTracked).toBe(false);
    expect(index.meta.respectsGitignore).toBe(true);
    expect(index.files.map((file) => file.path)).toEqual(["kept.py"]);
  }, SCAN_TIMEOUT_MS);

  it("reports ignored files when --all-files is asked for, so nothing is hidden by accident", async () => {
    const index = await scan(root, true);
    expect(index.meta.respectsGitignore).toBe(false);
    expect(index.files.map((file) => file.path)).toEqual(["ignored/thing.py", "kept.py"]);
  }, SCAN_TIMEOUT_MS);
});
