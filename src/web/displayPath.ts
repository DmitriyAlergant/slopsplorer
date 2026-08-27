/**
 * Make a project-relative path relative to a narrower UI scope.
 *
 * The file table draws a whole subtree, so a path is stated as an offset from
 * the folder the panel heading names rather than from the scan root.
 */
export function pathRelativeTo(path: string, root: string): string {
  if (!root) return path;
  if (path === root) return ".";
  const prefix = `${root}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/**
 * Is `path` the folder `root` or a folder inside it?
 *
 * The scan root is the empty path and holds everything, so it answers true for
 * every path rather than by a prefix test.
 */
export function isInsideFolder(path: string, root: string): boolean {
  return root === "" || path === root || path.startsWith(`${root}/`);
}
