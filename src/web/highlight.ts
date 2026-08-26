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
  ["html", "xml"], ["xml", "xml"], ["vue", "xml"], ["svelte", "xml"],
  ["sql", "sql"],
]);

/** Render source as highlighted HTML, falling back to plain escaped text. */
export function highlightSource(path: string, source: string): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  const language = BY_EXTENSION.get(extension);
  if (!language || !hljs.getLanguage(language)) {
    return hljs.highlight(source, { language: "plaintext" }).value;
  }
  return hljs.highlight(source, { language, ignoreIllegals: true }).value;
}
