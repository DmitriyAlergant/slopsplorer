import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanSourceTree, type ScanIndex } from "../src/scanner/scan.ts";
import { parseViewRequest } from "../src/server/aggregate.ts";
import { composeBrief } from "../src/server/brief.ts";
import type { AskRequest, ViewRequest } from "../src/shared/api.ts";

const SCAN_TIMEOUT_MS = 60_000;

let root: string;
let index: ScanIndex;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-brief-"));
  await mkdir(path.join(root, "engine"), { recursive: true });
  await mkdir(path.join(root, "docs"), { recursive: true });
  await writeFile(
    path.join(root, "engine", "run.ts"),
    "export function run(times: number): number {\n  return times * 2;\n}\n",
    "utf8",
  );
  await writeFile(path.join(root, "docs", "guide.md"), "# Guide\n\nHow to run it.\n", "utf8");
  index = await scanSourceTree({
    root, tokenizer: "o200k_base", allFiles: false, exclude: [], maxFileBytes: 2 * 1024 * 1024, concurrency: 4,
  });
}, SCAN_TIMEOUT_MS);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function askFor(view: Partial<ViewRequest>, ask: Partial<AskRequest> = {}): AskRequest {
  return {
    agentId: "claude",
    question: "",
    lastViewedPath: null,
    ...ask,
    view: parseViewRequest({ ...parseViewRequest({}), kinds: ["code", "test", "text"], ...view }),
  };
}

describe("the brief an ask sends", () => {
  it("names the subject, the unit, the scope, and the figures of a scan", () => {
    const brief = composeBrief(index, askFor({ measure: "tokens" }, { question: "Where is the weight?" }));
    expect(brief).toContain(`Subject: a scan of ${root}`);
    expect(brief).toContain("Unit on screen: tokens, counted with the o200k_base tokenizer");
    expect(brief).toContain("Drilled into: the whole project");
    expect(brief).toContain("Selected: the project root");
    expect(brief).toContain("Flavors counted: Code, Tests, Docs");
    expect(brief).toContain("Where is the weight?");
    expect(brief).toContain("Do not change any file.");
    expect(brief).toMatch(/The selection holds 2 files and \d+ tokens\./);
  });

  it("names the drill, the selection, the filter, and the last file opened", () => {
    const brief = composeBrief(index, askFor(
      { drillPath: "engine", selected: { rowKind: "folder", path: "engine" }, query: "run" },
      { lastViewedPath: "engine/run.ts" },
    ));
    expect(brief).toContain("Drilled into: engine");
    expect(brief).toContain("Selected: engine");
    expect(brief).toContain('Path filter: "run"');
    expect(brief).toContain("Last file they opened: engine/run.ts");
  });

  it("says a selection of a folder's own files is about those files", () => {
    const brief = composeBrief(index, askFor({ selected: { rowKind: "files", path: "engine" } }));
    expect(brief).toContain("Selected: the files directly in engine");
  });

  it("leaves out a filter that is not set, and a file that was never opened", () => {
    const brief = composeBrief(index, askFor({}));
    expect(brief).not.toContain("Path filter");
    expect(brief).not.toContain("Last file they opened");
  });

  it("asks for a description of the page when the reader typed no question", () => {
    const brief = composeBrief(index, askFor({}));
    expect(brief).toContain("Tell me what I am looking at here");
  });

  it("names the flavors the switches keep, and says when generated files are counted", () => {
    const kept = composeBrief(index, askFor({ kinds: ["code"], showGenerated: false }));
    expect(kept).toContain("Flavors counted: Code\n");

    const withGenerated = composeBrief(index, askFor({ kinds: ["code", "data"], showGenerated: true }));
    expect(withGenerated).toContain("Flavors counted: Code, Data & Conf, and generated files");
  });

  it("forces the aspect of a scan, because a scanned file has one content", () => {
    const brief = composeBrief(index, askFor({ measure: "codeLines", aspect: "churn" }));
    expect(brief).toContain("Unit on screen: LOC,");
  });
});
