import type { FileKind } from "../shared/api.ts";

interface FileKindDetails {
  label: string;
  description: string;
}

/** User-facing names and explanations for the stable file-kind wire values. */
export const FILE_KIND_DETAILS: Readonly<Record<FileKind, FileKindDetails>> = {
  code: { label: "Code", description: "Source and application code." },
  test: { label: "Tests", description: "Files in test folders or with common test naming patterns." },
  text: { label: "Docs", description: "Markdown and other prose documentation." },
  i18n: { label: "i18n", description: "Translation catalogues and locale files." },
  data: { label: "Data & Config", description: "Structured data and configuration formats such as JSON, YAML, TOML, XML, CSV, and dependency manifests." },
  other: { label: "Other", description: "Scannable text files that do not fit another flavor, such as HTML." },
};
