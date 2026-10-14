import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import ignore, { type Ignore } from "ignore";
import { EXCLUDED_DIRECTORIES } from "./classify.ts";

const execFileAsync = promisify(execFile);

/** Marks a static export root so later scans do not measure generated bundle data. */
export const STATIC_EXPORT_MARKER = ".slopsplorer-export";

/** Whether `root` sits inside a Git worktree. */
async function isGitWorktree(root: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root });
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

/**
 * List the files Git considers part of the project under `root`.
 *
 * `--cached --others --exclude-standard` is tracked files plus untracked files
 * that no ignore rule covers, so a file created a minute ago shows up while
 * ignored dependencies and build output stay out of the map.
 */
async function listGitFiles(root: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "."],
    { cwd: root, maxBuffer: 256 * 1024 * 1024, encoding: "utf8" },
  );
  return [...new Set(stdout.split("\0").filter(Boolean))];
}

/** Every path in the stage-zero index, without working-tree-only files. */
export async function listIndexFiles(root: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-files", "-z", "--cached", "--", "."],
    { cwd: root, maxBuffer: 256 * 1024 * 1024, encoding: "utf8" },
  );
  return [...new Set(stdout.split("\0").filter(Boolean))];
}

/** Ignored export markers, which the ordinary Git listing intentionally omits. */
async function listIgnoredGitExportMarkers(root: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "git",
    [
      "ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--",
      STATIC_EXPORT_MARKER, `:(glob)**/${STATIC_EXPORT_MARKER}`,
    ],
    { cwd: root, maxBuffer: 256 * 1024 * 1024, encoding: "utf8" },
  );
  return stdout.split("\0").filter(Boolean);
}

/** One `.gitignore` file, with the directory its patterns are relative to. */
interface IgnoreScope {
  /** Directory holding the `.gitignore`, relative to the scan root. */
  base: string;
  matcher: Ignore;
}

async function loadIgnoreScope(directory: string, relative: string): Promise<IgnoreScope | null> {
  try {
    const contents = await readFile(path.join(directory, ".gitignore"), "utf8");
    return { base: relative, matcher: ignore().add(contents) };
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return null;
    throw cause;
  }
}

/** Whether any enclosing `.gitignore` covers this path. */
function isIgnored(scopes: readonly IgnoreScope[], relativePath: string, isDirectory: boolean): boolean {
  for (const scope of scopes) {
    const relativeToScope = scope.base ? relativePath.slice(scope.base.length + 1) : relativePath;
    if (!relativeToScope) continue;
    const candidate = isDirectory ? `${relativeToScope}/` : relativeToScope;
    if (scope.matcher.ignores(candidate)) return true;
  }
  return false;
}

async function listFilesystemFiles(
  root: string,
  respectGitignore: boolean,
): Promise<string[]> {
  const found: string[] = [];

  async function descend(directory: string, relative: string, scopes: readonly IgnoreScope[]): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });

    let activeScopes = scopes;
    if (respectGitignore) {
      const scope = await loadIgnoreScope(directory, relative);
      if (scope) activeScopes = [...scopes, scope];
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
        if (!respectGitignore || !isIgnored(activeScopes, relativePath, false)) found.push(relativePath);
        continue;
      }
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORIES.has(entry.name)) continue;
        if (respectGitignore && isIgnored(activeScopes, childRelative, true)) continue;
        await descend(path.join(directory, entry.name), childRelative, activeScopes);
      } else if (entry.isFile()) {
        if (entry.name === STATIC_EXPORT_MARKER) {
          found.push(childRelative);
          continue;
        }
        if (respectGitignore && isIgnored(activeScopes, childRelative, false)) continue;
        found.push(childRelative);
      }
    }
  }

  await descend(root, "", []);
  return found;
}

/**
 * All files one revision holds, without touching the working tree.
 *
 * A comparison measures only the files a change touched, and that is not
 * enough to judge the shape of a folder. This gives the second producer the
 * same view of the tree that a scan gets from its own listing.
 */
export async function listRevisionFiles(root: string, rev: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-tree", "-r", "-z", "--name-only", rev, "--", "."],
    { cwd: root, maxBuffer: 256 * 1024 * 1024, encoding: "utf8" },
  );
  return stdout.split("\0").filter(Boolean);
}

/** The accepted source files one revision holds. */
export async function listRevisionSourceFiles(
  root: string, rev: string, exclude: readonly string[],
): Promise<string[]> {
  const inventory = await listRevisionFiles(root, rev);
  return acceptSourcePaths(inventory, exclude);
}

export interface FileListing {
  relativePaths: string[];
  /** Complete path inventory, including markers that identify excluded export roots. */
  inventory: string[];
  /** The listing came from the Git index rather than a filesystem walk. */
  gitTracked: boolean;
  /** `.gitignore` rules were applied, by Git or by the walker. */
  respectsGitignore: boolean;
}

export interface ListOptions {
  /** Walk the filesystem and ignore `.gitignore` entirely. */
  allFiles: boolean;
  exclude: readonly string[];
}

/**
 * Produce the candidate file list for a scan.
 *
 * Inside a Git worktree the index is authoritative. Outside one the walker
 * applies `.gitignore` itself, so a plain folder behaves the same way. Passing
 * `allFiles` opts out of both and reports everything the built-in directory
 * exclusions allow.
 */
export async function listSourceFiles(root: string, options: ListOptions): Promise<FileListing> {
  const useGit = !options.allFiles && (await isGitWorktree(root));
  const respectGitignore = !options.allFiles;
  const candidates = useGit
    ? await listGitFiles(root)
    : await listFilesystemFiles(root, respectGitignore);
  const exportMarkers = useGit ? await listIgnoredGitExportMarkers(root) : [];
  const inventory = [...candidates, ...exportMarkers];

  return {
    relativePaths: acceptSourcePaths(candidates, options.exclude, inventory),
    inventory,
    gitTracked: useGit,
    respectsGitignore: respectGitignore,
  };
}

/**
 * Apply path exclusions before reading content.
 * Both producers use these rules; comparisons retain rejected paths as unmeasured rows.
 */
export function acceptSourcePaths(
  candidates: readonly string[], exclude: readonly string[], inventory: readonly string[] = candidates,
): string[] {
  const extraExclusions = new Set(exclude);
  const exportRoots = inventory
    .filter((relativePath) => path.posix.basename(relativePath) === STATIC_EXPORT_MARKER)
    .map((relativePath) => {
      const directory = path.posix.dirname(relativePath);
      return directory === "." ? "" : directory;
    });
  return candidates
    .filter((relativePath) => !exportRoots.some((root) => (
      root === "" || relativePath === root || relativePath.startsWith(`${root}/`)
    )))
    .filter((relativePath) => {
      const directories = path.posix.dirname(relativePath).split("/").filter((part) => part && part !== ".");
      return !directories.some((directory) => extraExclusions.has(directory));
    })
    .sort();
}

/** Git modes distinguish links and submodules from text blobs without reading their targets. */
export async function listGitFileModes(
  root: string, side: { kind: "revision"; rev: string } | { kind: "index" },
): Promise<Map<string, string>> {
  const args = side.kind === "revision"
    ? ["ls-tree", "-r", "-z", side.rev, "--", "."]
    : ["ls-files", "--stage", "-z", "--", "."];
  const { stdout } = await execFileAsync("git", args, { cwd: root, maxBuffer: 256 * 1024 * 1024, encoding: "utf8" });
  const modes = new Map<string, string>();
  for (const record of stdout.split("\0")) {
    if (!record) continue;
    const tab = record.indexOf("\t");
    if (tab < 0) throw new Error("Git file listing has no path separator");
    modes.set(record.slice(tab + 1), record.slice(0, 6));
  }
  return modes;
}
