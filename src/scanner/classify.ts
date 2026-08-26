import path from "node:path";
import type { FileKind } from "../shared/api.ts";

/**
 * Extensions the scanner will read. Anything else is treated as a binary or
 * uninteresting artifact and never enters a snapshot.
 */
export const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".adoc", ".bash", ".bats", ".c", ".cc", ".cjs", ".cpp", ".cs", ".csv",
  ".css", ".fish", ".go", ".h", ".hpp", ".html", ".java", ".js", ".json",
  ".jsonc", ".jsx", ".ksh", ".kt", ".kts", ".lock", ".lua", ".md", ".mdx",
  ".mjs", ".php", ".po", ".pot", ".prisma", ".ps1", ".py", ".pyi", ".rb",
  ".rs", ".rst", ".scss", ".sh", ".sql", ".svelte", ".swift", ".toml", ".ts",
  ".tsv", ".tsx", ".txt", ".vue", ".xml", ".yaml", ".yml", ".zsh",
]);

/** Directories never worth measuring, even when a filesystem walk reaches them. */
export const EXCLUDED_DIRECTORIES: ReadonlySet<string> = new Set([
  ".git", ".hg", ".idea", ".mypy_cache", ".next", ".nuxt", ".pytest_cache",
  ".ruff_cache", ".svelte-kit", ".tox", ".turbo", ".venv", ".vscode",
  "__pycache__", "node_modules", "target", "venv", "vendor",
]);

const CODE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".bash", ".bats", ".c", ".cc", ".cjs", ".cpp", ".cs", ".css", ".fish",
  ".go", ".h", ".hpp", ".java", ".js", ".jsx", ".ksh", ".kt", ".kts", ".lua",
  ".mjs", ".php", ".prisma", ".ps1", ".py", ".pyi", ".rb", ".rs", ".scss",
  ".sh", ".sql", ".svelte", ".swift", ".ts", ".tsx", ".vue", ".zsh",
]);

const DATA_EXTENSIONS: ReadonlySet<string> = new Set([
  ".csv", ".json", ".jsonc", ".toml", ".tsv", ".xml", ".yaml", ".yml",
]);

/** Plain-text manifests whose contents are configuration rather than prose. */
const DATA_NAMES: ReadonlySet<string> = new Set(["requirements.txt"]);

const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([".adoc", ".md", ".mdx", ".rst", ".txt"]);

const I18N_DIRECTORIES: ReadonlySet<string> = new Set([
  "i18n", "intl", "lang", "locale", "locales", "translation", "translations",
]);

const TEST_DIRECTORIES: ReadonlySet<string> = new Set([
  "__tests__", "e2e", "spec", "specs", "test", "tests",
]);

/**
 * ISO 639-1 codes, used to recognise catalogue files named after a language.
 *
 * A curated list matters here: matching any two-or-three letter stem would
 * misfile `api.json`, `db.yaml`, and `dev.yaml` as translation catalogues.
 */
const LANGUAGE_CODES: ReadonlySet<string> = new Set([
  "af", "am", "ar", "az", "be", "bg", "bn", "bs", "ca", "cs", "cy", "da", "de",
  "el", "en", "eo", "es", "et", "eu", "fa", "fi", "fil", "fr", "ga", "gl", "he",
  "hi", "hr", "hu", "hy", "id", "is", "it", "ja", "ka", "kk", "km", "kn", "ko",
  "lt", "lv", "mk", "ml", "mn", "mr", "ms", "my", "nb", "ne", "nl", "nn", "no",
  "pa", "pl", "pt", "ro", "ru", "si", "sk", "sl", "sq", "sr", "sv", "sw", "ta",
  "te", "th", "tr", "uk", "ur", "uz", "vi", "zh",
]);

/** Whether any member of `candidates` is in `known`. */
function containsAny(candidates: Iterable<string>, known: ReadonlySet<string>): boolean {
  for (const candidate of candidates) {
    if (known.has(candidate)) return true;
  }
  return false;
}

/** `en`, `de-DE`, `pt_BR` - a language code with an optional region suffix. */
const LOCALE_STEM = /^([a-z]{2,3})(?:[-_][a-z]{2,4})?$/;

function isLocaleStem(stem: string): boolean {
  const match = LOCALE_STEM.exec(stem);
  return match !== null && LANGUAGE_CODES.has(match[1]!);
}

/**
 * Whether the filename itself declares the file to be a test.
 *
 * This is the strong half of test detection: the name is an assertion about
 * the file's role, so it outranks what the extension says about its format.
 */
function isTestFileName(name: string): boolean {
  if (name.startsWith("test_") || name.startsWith("spec_")) return true;
  if (/_(test|spec)\.[a-z]+$/.test(name)) return true;
  return name.includes(".test.") || name.includes(".spec.");
}

/**
 * Classify a file into the buckets the visibility switches control.
 *
 * The two halves of test detection carry different weight. A test-shaped
 * filename outranks the extension, because the name states the file's role.
 * Sitting in a test directory is only a location, and a test tree holds
 * fixtures, corpora, and sample documents alongside its code, so that signal
 * ranks below format: `tests/fixtures/events.json` is data and
 * `tests/paste/clipboard.html` is other, while `tests/conftest.py` is a test.
 */
export function classifyFile(relativePath: string): FileKind {
  const name = path.posix.basename(relativePath).toLowerCase();
  const extension = path.posix.extname(name);
  const stem = name.slice(0, name.length - extension.length);
  const directories = new Set(path.posix.dirname(relativePath).toLowerCase().split("/").filter((part) => part && part !== "."));

  if (extension === ".po" || extension === ".pot") return "i18n";
  if (containsAny(directories, I18N_DIRECTORIES)) return "i18n";
  if ((extension === ".json" || extension === ".yaml" || extension === ".yml") && isLocaleStem(stem)) return "i18n";
  if (isTestFileName(name)) return "test";
  if (DATA_NAMES.has(name)) return "data";
  if (DATA_EXTENSIONS.has(extension)) return "data";
  if (TEXT_EXTENSIONS.has(extension)) return "text";
  const inTestDirectory = containsAny(directories, TEST_DIRECTORIES);
  if (CODE_EXTENSIONS.has(extension)) return inTestDirectory ? "test" : "code";
  return "other";
}

/**
 * Grammars where a high string-literal share carries no information.
 *
 * A shell script quotes nearly everything it handles - paths, messages,
 * heredocs of SQL - so the whole family sits between 70% and 97% literal
 * content while still being ordinary scripts.
 */
const LITERAL_HEAVY_GRAMMARS: ReadonlySet<string> = new Set(["bash", "powershell"]);

/** Below this, a file is too small for its literal share to mean anything. */
const MIN_CONTENT_CHARS = 1000;

/** The share of non-comment content that must sit inside literals. */
const DATA_LITERAL_SHARE = 0.9;

/** The share of literal content one single literal may hold. */
const MAX_LITERAL_DOMINANCE = 0.25;

/** Filenames that name the catalogue's purpose, as in `desktop-i18n.ts`. */
const I18N_NAME = /i18n|intl|translat|locale/;

/** What one file's content says about it, beyond what its path says. */
export interface ContentShape {
  /** The grammar that produced the measurements, or `null` if none applied. */
  grammar: string | null;
  literalChars: number;
  contentChars: number;
  largestLiteral: number;
}

/**
 * Re-file source code that is really a payload rather than logic.
 *
 * A hand-maintained translation catalogue, a table of canned messages, or a
 * bundle of queries carries a code extension while being data, and its weight
 * behaves like data: it grows with content and is not read as logic. Three
 * conditions have to hold together, because each alone has a false positive
 * measured on a real repository:
 *
 *   - Nearly all non-comment content is literal. An icon component whose SVG
 *     path attributes reach 88% is still a component.
 *   - No single literal dominates. One giant template literal of injected
 *     script or one embedded SVG reaches 99% literal content in a file that is
 *     unambiguously code.
 *   - The grammar is one where quoting is not the norm, and the file is large
 *     enough for the ratio to be more than an accident.
 */
export function refineKindByContent(kind: FileKind, relativePath: string, shape: ContentShape): FileKind {
  if (kind !== "code") return kind;
  if (shape.grammar === null || LITERAL_HEAVY_GRAMMARS.has(shape.grammar)) return kind;
  if (shape.contentChars < MIN_CONTENT_CHARS) return kind;
  if (shape.literalChars < shape.contentChars * DATA_LITERAL_SHARE) return kind;
  if (shape.largestLiteral > shape.literalChars * MAX_LITERAL_DOMINANCE) return kind;
  return I18N_NAME.test(path.posix.basename(relativePath).toLowerCase()) ? "i18n" : "data";
}

const GENERATED_DIRECTORIES: ReadonlySet<string> = new Set([
  "__generated__", "coverage", "dist", "generated", "gen",
]);

const GENERATED_SUFFIXES: readonly string[] = [
  ".generated.ts", ".generated.tsx", ".generated.js", ".g.ts", ".g.dart",
  ".gen.go", "_generated.go", ".pb.go", "_pb2.py", "_pb2_grpc.py", "_pb.ts",
  ".min.js", ".min.css", ".map", ".lock",
];

const GENERATED_NAMES: ReadonlySet<string> = new Set([
  "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "composer.lock",
]);

/** Detect generated output from path conventions alone, without reading content. */
export function isGenerated(relativePath: string): boolean {
  const name = path.posix.basename(relativePath).toLowerCase();
  const directories = path.posix.dirname(relativePath).toLowerCase().split("/").filter((part) => part && part !== ".");
  if (containsAny(directories, GENERATED_DIRECTORIES)) return true;
  if (GENERATED_NAMES.has(name)) return true;
  return GENERATED_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/** Trailing version digits on an interpreter name, as in `python3.12` or `perl5`. */
const INTERPRETER_VERSION_SUFFIX = /[0-9]+(?:\.[0-9]+)*$/;

/**
 * The interpreter named on a leading `#!` line, lowercased and unversioned.
 *
 * `#!/bin/bash`, `#!/usr/bin/env bash -e`, and `#!/usr/bin/env -S python3 -u`
 * yield `bash`, `bash`, and `python`. Scripts routinely carry no extension, and
 * the shebang is the only thing left to identify them by.
 */
export function shebangInterpreter(text: string): string | null {
  if (!text.startsWith("#!")) return null;
  const lineEnd = text.indexOf("\n");
  const words = text.slice(2, lineEnd === -1 ? undefined : lineEnd).trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (first === undefined) return null;
  let name = path.posix.basename(first).toLowerCase();
  if (name === "env") {
    // `env` runs its first non-option argument, which is the real interpreter.
    const target = words.slice(1).find((word) => !word.startsWith("-"));
    if (target === undefined) return null;
    name = path.posix.basename(target).toLowerCase();
  }
  const unversioned = name.replace(INTERPRETER_VERSION_SUFFIX, "");
  return unversioned === "" ? name : unversioned;
}

/** Whether the scanner should read this path at all. */
export function isSourceFile(relativePath: string): boolean {
  const extension = path.posix.extname(relativePath).toLowerCase();
  if (!SOURCE_EXTENSIONS.has(extension)) return false;
  const directories = path.posix.dirname(relativePath).split("/").filter((part) => part && part !== ".");
  return !containsAny(directories, EXCLUDED_DIRECTORIES);
}
