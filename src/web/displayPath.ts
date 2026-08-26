/** Make a project-relative path relative to a narrower UI scope. */
export function pathRelativeTo(path: string, root: string): string {
  if (!root) return path;
  if (path === root) return ".";
  const prefix = `${root}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/** Format a file from a UI scope, optionally making that relativity explicit. */
export function displayFilePath(path: string, root: string, markRelative: boolean): string {
  const relativePath = pathRelativeTo(path, root);
  return markRelative ? `./${relativePath}` : relativePath;
}
