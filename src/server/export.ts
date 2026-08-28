import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { mapWithConcurrency, type ScanProgress } from "../scanner/scan.ts";
import type { ScanIndex } from "../scanner/scan.ts";
import { STATIC_EXPORT_MARKER } from "../scanner/walk.ts";
import type { CommitSpine, SnapshotBacklink, SnapshotContext, SnapshotSourceRecord } from "../shared/api.ts";
import { serializeScanIndex } from "../shared/index.ts";
import { openSourceReader, SourceReadError, type SourceProducer } from "./source.ts";

const SNAPSHOT_CONTEXT_PLACEHOLDER = "__SLOPSPLORER_SNAPSHOT_CONTEXT__";

export interface StaticBundleOptions {
  /** Built web assets containing both the live and snapshot HTML entries. */
  clientRoot: string;
  output: string;
  index: ScanIndex;
  producer: SourceProducer;
  spine: CommitSpine | null;
  concurrency: number;
  /** Review page named by a full pull request URL, or `null`. */
  backlink: SnapshotBacklink | null;
  onProgress?: (progress: ScanProgress) => void;
}

function json(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function embeddedJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

/** Create a missing output directory, or prove that an existing one is empty. */
export async function prepareStaticBundleOutput(output: string): Promise<void> {
  let existing;
  try {
    existing = await stat(output);
  } catch (cause) {
    if (!(cause instanceof Error) || !("code" in cause) || cause.code !== "ENOENT") throw cause;
    await mkdir(output, { recursive: true });
    return;
  }
  if (!existing.isDirectory()) throw new Error(`export destination is not a directory: ${output}`);
  if ((await readdir(output)).length > 0) throw new Error(`export destination is not empty: ${output}`);
}

/** Write a complete static explorer into a missing or empty directory. */
export async function writeStaticBundle(options: StaticBundleOptions): Promise<void> {
  await prepareStaticBundleOutput(options.output);
  const outputMode = (await stat(options.output)).mode & 0o7777;
  const staging = await mkdtemp(path.join(
    path.dirname(options.output), `.${path.basename(options.output)}.slopsplorer-`,
  ));
  let staged = true;
  try {
    await writeStaticBundleContents({ ...options, output: staging });
    await chmod(staging, outputMode);
    await rmdir(options.output);
    try {
      await rename(staging, options.output);
      staged = false;
    } catch (cause) {
      await mkdir(options.output, { recursive: true });
      throw cause;
    }
  } finally {
    if (staged) await rm(staging, { recursive: true, force: true });
  }
}

/** Build in a private sibling directory so a failed export never looks complete. */
async function writeStaticBundleContents(options: StaticBundleOptions): Promise<void> {
  await cp(options.clientRoot, options.output, { recursive: true });
  const snapshotEntry = path.join(options.output, "snapshot.html");
  const snapshotHtml = await readFile(snapshotEntry, "utf8");
  if (!snapshotHtml.includes(SNAPSHOT_CONTEXT_PLACEHOLDER)) {
    throw new Error("the built snapshot entry has no context placeholder");
  }
  const context: SnapshotContext = { backlink: options.backlink };
  await writeFile(
    path.join(options.output, "index.html"),
    snapshotHtml.replace(SNAPSHOT_CONTEXT_PLACEHOLDER, embeddedJson(context)),
    "utf8",
  );
  await rm(path.join(options.output, "snapshot.html"));

  const dataRoot = path.join(options.output, "data");
  const sourceRoot = path.join(dataRoot, "sources");
  await mkdir(sourceRoot, { recursive: true });
  await Promise.all([
    writeFile(path.join(options.output, STATIC_EXPORT_MARKER), "", "utf8"),
    writeFile(
      path.join(dataRoot, "index.json"),
      json(serializeScanIndex(options.index, options.index.meta.rootName)),
      "utf8",
    ),
    writeFile(path.join(dataRoot, "spine.json"), json(options.spine), "utf8"),
  ]);

  const reader = await openSourceReader(options.index, options.producer, options.index.files);
  try {
    let completedFiles = 0;
    options.onProgress?.({ completedFiles, totalFiles: options.index.files.length });
    await mapWithConcurrency(options.index.files, options.concurrency, async (file, fileIndex) => {
      let record: SnapshotSourceRecord;
      try {
        record = await reader.read(file.path);
      } catch (cause) {
        // The same refusal the live route sends for this file. Anything else
        // says the export itself is broken, and stops the export.
        if (!(cause instanceof SourceReadError)) throw cause;
        record = { error: cause.message };
      }
      await writeFile(path.join(sourceRoot, `${fileIndex}.json`), json(record), "utf8");
    }, () => {
      completedFiles += 1;
      options.onProgress?.({ completedFiles, totalFiles: options.index.files.length });
    });
  } finally {
    reader.dispose();
  }
}
