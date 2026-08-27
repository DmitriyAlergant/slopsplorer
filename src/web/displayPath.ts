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
