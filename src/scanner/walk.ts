import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import ignore, { type Ignore } from "ignore";
import { EXCLUDED_DIRECTORIES, isSourceFile } from "./classify.ts";

const execFileAsync = promisify(execFile);

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
  } catch {
    return null;
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
  extraExclusions: ReadonlySet<string>,
  respectGitignore: boolean,
): Promise<string[]> {
  const found: string[] = [];

  async function descend(directory: string, relative: string, scopes: readonly IgnoreScope[]): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    let activeScopes = scopes;
    if (respectGitignore) {
      const scope = await loadIgnoreScope(directory, relative);
      if (scope) activeScopes = [...scopes, scope];
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORIES.has(entry.name) || extraExclusions.has(entry.name)) continue;
        if (respectGitignore && isIgnored(activeScopes, childRelative, true)) continue;
        await descend(path.join(directory, entry.name), childRelative, activeScopes);
      } else if (entry.isFile()) {
        if (respectGitignore && isIgnored(activeScopes, childRelative, false)) continue;
        found.push(childRelative);
      }
    }
  }

  await descend(root, "", []);
  return found;
}

/**
 * The source files one revision holds, without touching the working tree.
 *
 * A comparison measures only the files a change touched, and that is not
 * enough to judge the shape of a folder. This gives the second producer the
 * same view of the tree that a scan gets from its own listing.
 */
export async function listRevisionSourceFiles(
  root: string, rev: string, exclude: readonly string[],
): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-tree", "-r", "-z", "--name-only", rev, "--", "."],
    { cwd: root, maxBuffer: 256 * 1024 * 1024, encoding: "utf8" },
  );
  return acceptSourcePaths(stdout.split("\0").filter(Boolean), exclude);
}

export interface FileListing {
  relativePaths: string[];
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
  const extraExclusions = new Set(options.exclude);
  const useGit = !options.allFiles && (await isGitWorktree(root));
  const respectGitignore = !options.allFiles;
  const candidates = useGit
    ? await listGitFiles(root)
    : await listFilesystemFiles(root, extraExclusions, respectGitignore);

  return {
    relativePaths: acceptSourcePaths(candidates, options.exclude),
    gitTracked: useGit,
    respectsGitignore: respectGitignore,
  };
}

/**
 * Reduce a candidate list to the files a scan measures, sorted by path.
 *
 * Both producers of an index end here, so a diff and a scan can never disagree
 * about what counts as a source file. The sort is what makes every subtree a
 * contiguous slice of `ScanIndex.files`.
 */
export function acceptSourcePaths(candidates: readonly string[], exclude: readonly string[]): string[] {
  const extraExclusions = new Set(exclude);
  return candidates
    .filter((relativePath) => isSourceFile(relativePath))
    .filter((relativePath) => {
      const directories = path.posix.dirname(relativePath).split("/").filter((part) => part && part !== ".");
      return !directories.some((directory) => extraExclusions.has(directory));
    })
    .sort();
}
