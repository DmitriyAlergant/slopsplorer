import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

/** Only the grammars the scanner can surface are registered, to keep the bundle small. */
for (const [name, language] of Object.entries({
  bash, cpp, csharp, css, go, ini, java, javascript, json, markdown, php,
  python, ruby, rust, scss, sql, typescript, xml, yaml,
})) {
  hljs.registerLanguage(name, language);
}

const BY_EXTENSION: ReadonlyMap<string, string> = new Map([
  ["c", "cpp"], ["cc", "cpp"], ["cpp", "cpp"], ["h", "cpp"], ["hpp", "cpp"],
  ["cs", "csharp"], ["css", "css"], ["scss", "scss"],
  ["go", "go"], ["java", "java"], ["rs", "rust"], ["rb", "ruby"], ["php", "php"],
  ["js", "javascript"], ["jsx", "javascript"], ["mjs", "javascript"], ["cjs", "javascript"],
  ["ts", "typescript"], ["tsx", "typescript"],
  ["py", "python"], ["pyi", "python"],
  ["sh", "bash"], ["zsh", "bash"],
  ["json", "json"], ["jsonc", "json"],
  ["yaml", "yaml"], ["yml", "yaml"], ["toml", "ini"],
  ["md", "markdown"], ["mdx", "markdown"],
  ["htm", "xml"], ["html", "xml"], ["xhtml", "xml"], ["xml", "xml"], ["vue", "xml"], ["svelte", "xml"],
  ["sql", "sql"],
]);

const ESCAPES: ReadonlyMap<string, string> = new Map([
  ["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ['"', "&quot;"], ["'", "&#x27;"],
]);

function escapeText(source: string): string {
  return source.replace(/[&<>"']/g, (character) => ESCAPES.get(character)!);
}

/** Render source as highlighted HTML, falling back to plain escaped text. */
export function highlightSource(path: string, source: string): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  const language = BY_EXTENSION.get(extension);
  if (language === undefined) return escapeText(source);
  return hljs.highlight(source, { language, ignoreIllegals: true }).value;
}

/**
 * The same highlighting for a fenced block, whose language is written on the
 * fence rather than implied by a file name.
 *
 * The fence may carry an extension, a language name, or a word nothing here
 * knows, and only the first two can be highlighted.
 */
export function highlightLanguage(fenceLanguage: string, source: string): string {
  const named = fenceLanguage.toLowerCase();
  const language = BY_EXTENSION.get(named) ?? named;
  if (hljs.getLanguage(language) === undefined) return escapeText(source);
  return hljs.highlight(source, { language, ignoreIllegals: true }).value;
}

/**
 * The same highlighting, cut into one HTML string per line.
 *
 * A comparison draws its lines one row at a time, and highlighting each row on
 * its own would lose every construct that spans lines: a block comment, a
 * template string, a here-document. So the side is highlighted whole and the
 * spans that cross a line break are closed and reopened around it.
 */
export function highlightToLines(path: string, source: string): string[] {
  const html = highlightSource(path, source);
  const lines: string[] = [];
  const open: string[] = [];
  let current = "";
  let cursor = 0;
  while (cursor < html.length) {
    const tagStart = html.indexOf("<", cursor);
    const text = tagStart === -1 ? html.slice(cursor) : html.slice(cursor, tagStart);
    const pieces = text.split("\n");
    for (const [index, piece] of pieces.entries()) {
      if (index > 0) {
        lines.push(current + "</span>".repeat(open.length));
        current = open.join("");
      }
      current += piece;
    }
    if (tagStart === -1) break;
    const tagEnd = html.indexOf(">", tagStart);
    const tag = html.slice(tagStart, tagEnd + 1);
    if (tag.startsWith("</")) open.pop();
    else open.push(tag);
    current += tag;
    cursor = tagEnd + 1;
  }
  lines.push(current + "</span>".repeat(open.length));
  return lines;
}
