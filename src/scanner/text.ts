import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import type { UnmeasuredReason } from "../shared/api.ts";

export type TextRead = { text: string; reason: null } | { text: null; reason: UnmeasuredReason };

/** Decode once, before either measurement or preview sees the content. */
export function decodeText(buffer: Uint8Array): TextRead {
  const encoding = buffer[0] === 0xff && buffer[1] === 0xfe ? "utf-16le"
    : buffer[0] === 0xfe && buffer[1] === 0xff ? "utf-16be" : "utf-8";
  if (encoding === "utf-8" && buffer.includes(0)) return { text: null, reason: "binary" };
  let text: string;
  try {
    text = new TextDecoder(encoding, { fatal: true }).decode(buffer);
  } catch (cause) {
    if (!(cause instanceof TypeError)) throw cause;
    return { text: null, reason: "unsupported-encoding" };
  }
  // Text can contain tabs, line endings and form feeds, but not binary controls.
  if (/[\x00-\x08\x0e-\x1f\x7f]/.test(text)) return { text: null, reason: "binary" };
  return { text, reason: null };
}

/** Known filesystem failures become visible outcomes; programming errors still fail the scan. */
export function readFailure(cause: unknown): TextRead {
  if (!(cause instanceof Error) || !("code" in cause)
    || !["ENOENT", "EACCES", "EPERM", "ENOTDIR", "EISDIR", "ELOOP"].includes(String(cause.code))) throw cause;
  return { text: null, reason: "unreadable" };
}

export async function readTextFile(root: string, relativePath: string, maxBytes: number, resolvedPath?: string): Promise<TextRead> {
  try {
    const absolute = resolvedPath ?? path.join(root, relativePath);
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) return { text: null, reason: "symlink" };
    if (info.isDirectory()) return { text: null, reason: "submodule" };
    if (!info.isFile()) return { text: null, reason: "unreadable" };
    if (info.size > maxBytes) return { text: null, reason: "too-large" };
    const resolvedFile = await realpath(absolute);
    const relative = path.relative(await realpath(root), resolvedFile);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return { text: null, reason: "symlink" };
    }
    const buffer = await readFile(resolvedFile);
    return buffer.length > maxBytes ? { text: null, reason: "too-large" } : decodeText(buffer);
  } catch (cause) {
    return readFailure(cause);
  }
}
