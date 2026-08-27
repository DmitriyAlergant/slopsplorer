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

/**
 * Directory names that hold a test tree.
 *
 * Curated rather than pattern-matched, for the same reason the language codes
 * are: a rule that accepted any name ending in `test` or `specs` would take
 * `db_engine_specs` and `plugin-chart-paired-t-test`, which are ordinary
 * source. The second group is the Gradle and Kotlin Multiplatform source sets,
 * where a whole test tree hangs off a name that is never the word `test` alone.
 */
const TEST_DIRECTORIES: ReadonlySet<string> = new Set([
  "__tests__", "e2e", "spec", "specs", "test", "tests",
  "androidinstrumentedtest", "androidtest", "androidunittest", "commontest",
  "functionaltest", "integrationtest", "iostest", "jstest", "jvmtest",
  "nativetest", "testfixtures",
]);

/**
 * Directory names that state that what they hold is a payload.
 *
 * A `.txt` or `.md` is prose by extension, but under one of these it is the
 * input or the recorded output of a test. Two files in neovim's
 * `test/functional/fixtures/` are 13% of that repository, and reporting them
 * as documentation says something false about the whole tree.
 */
const FIXTURE_DIRECTORIES: ReadonlySet<string> = new Set([
  "__snapshots__", "data", "fixture", "fixtures", "golden", "goldens",
  "sample", "samples", "snapshot", "snapshots", "testdata",
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
 * Whether the file sits in one language's folder of a translation tree, as
 * `conf/locale/nl/formats.py` and `Translation/lang/en/validation.php` do.
 *
 * Everything in such a folder is that language's copy, whatever format it is
 * written in. Both halves are needed. A bare `it/` or `id/` folder is not a
 * locale, and hugo's `docs/content/en/functions/lang/` holds prose about
 * translation rather than a translation, which is why the language code has to
 * be the folder the file is actually in.
 */
function isLocaleDirectory(directories: readonly string[]): boolean {
  const parent = directories[directories.length - 1];
  if (parent === undefined || !isLocaleStem(parent)) return false;
  return containsAny(directories, I18N_DIRECTORIES);
}

/**
 * A stem ending in a separated `test` or `spec`: `service_test`, `sbom.tests`,
 * `router-spec`, and vitest's type-test suffix, as in `defineComponent.test-d`.
 *
 * The separator is what makes the rule safe. Without it `latest` and
 * `manifest` would both read as tests.
 */
const SEPARATED_TEST_STEM = /(?:^|[^A-Za-z0-9])(?:test|spec)s?(?:-d)?$/i;

/**
 * A stem ending in a camel-case `Test` or `Spec`, which is how the JVM and
 * .NET name a test: `CallTest`, `HttpUrlTests`, `RouterSpec`.
 *
 * Case-sensitive on purpose. The uppercase letter is the whole word boundary
 * here, so reading this case-insensitively would call `latest.ts` a test.
 */
const CAMEL_TEST_STEM = /(?:^|[A-Za-z0-9])(?:Test|Spec)s?$/;

/**
 * Whether the filename declares the file to be a test whatever its format.
 *
 * This is the strong half of test detection: the name is an assertion about
 * the file's role, so it outranks what the extension says. Only the markers
 * that can mean nothing else belong here, which is why the broader suffix
 * conventions sit in `isTestSourceName` instead.
 */
function isTestFileName(name: string): boolean {
  if (name.startsWith("test_") || name.startsWith("spec_")) return true;
  if (/_(test|spec)\.[a-z]+$/.test(name)) return true;
  return name.includes(".test.") || name.includes(".spec.");
}

/**
 * Whether a source filename follows one of the test-suffix conventions.
 *
 * Read for a code extension only. On any other format the same suffix reads
 * as being *about* tests rather than being one: `.github/workflows/tests.yml`
 * is the CI configuration, `docs/unit-tests.txt` and `WritingPesterTests.md`
 * are prose, and `RolloutSpec.json` is a deployment specification.
 */
function isTestSourceName(name: string): boolean {
  const stem = name.slice(0, name.length - path.posix.extname(name).length);
  return SEPARATED_TEST_STEM.test(stem) || CAMEL_TEST_STEM.test(stem);
}

/**
 * Classify a file into the buckets the visibility switches control.
 *
 * One rule orders the whole function: a filename states the file's role, a
 * format states what the file is, and a directory only states where it sits.
 * So a test-shaped filename outranks the extension, and both outrank the
 * directory. The exception is the broad test-suffix conventions, which are
 * how source files are named and are read for a code extension only.
 *
 * A test tree holds fixtures, corpora, and sample documents beside its code,
 * and a translation tree holds the code that reads the catalogues beside the
 * catalogues, so location alone decides nothing: `tests/fixtures/events.json`
 * is data, `tests/paste/clipboard.html` is other, and `tests/conftest.py` is a
 * test, while `langs/i18n/i18n.go` is code and `docs/topics/i18n/
 * translation.txt` is prose.
 *
 * A directory is still what tells one use of an ambiguous format from another,
 * because `locales/fr_CA.json` and `config/api.json` are one format, and so
 * are a page of prose and a fixture with a `.txt` on the end.
 */
export function classifyFile(relativePath: string): FileKind {
  const name = path.posix.basename(relativePath);
  const lowercasedName = name.toLowerCase();
  const extension = path.posix.extname(lowercasedName);
  const stem = lowercasedName.slice(0, lowercasedName.length - extension.length);
  const directories = path.posix.dirname(relativePath).toLowerCase().split("/").filter((part) => part && part !== ".");

  if (extension === ".po" || extension === ".pot") return "i18n";
  if ((extension === ".json" || extension === ".yaml" || extension === ".yml") && isLocaleStem(stem)) return "i18n";
  if (isTestFileName(lowercasedName)) return "test";
  if (isLocaleDirectory(directories)) return "i18n";
  if (DATA_NAMES.has(lowercasedName)) return "data";
  if (DATA_EXTENSIONS.has(extension)) return containsAny(directories, I18N_DIRECTORIES) ? "i18n" : "data";
  if (TEXT_EXTENSIONS.has(extension)) return containsAny(directories, FIXTURE_DIRECTORIES) ? "data" : "text";
  if (CODE_EXTENSIONS.has(extension)) {
    return isTestSourceName(name) || containsAny(directories, TEST_DIRECTORIES) ? "test" : "code";
  }
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

/**
 * Paths that name the catalogue's purpose, as in `desktop-i18n.ts` or
 * `src/Illuminate/Translation/lang/en/validation.php`.
 *
 * The whole path, because a catalogue is as often named by the folder holding
 * it as by its own filename.
 */
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
  return I18N_NAME.test(relativePath.toLowerCase()) ? "i18n" : "data";
}

const GENERATED_DIRECTORIES: ReadonlySet<string> = new Set([
  "__generated__", "coverage", "dist", "generated", "gen",
]);

const GENERATED_SUFFIXES: readonly string[] = [
  ".g.ts", ".g.dart", ".pb.go", "_pb2.py", "_pb2_grpc.py", "_pb.ts",
  ".min.js", ".min.css", ".bundle.js", ".map", ".lock",
];

/**
 * The word a build tool puts in a stem, in whatever language it writes:
 * `vimfn.gen.lua`, `contracts.generated.ts`, `serializer.autogen.cs`,
 * `client_generated.go`, `zz_generated.deepcopy.go`.
 *
 * `gen` needs the dot, because `hugo_gen.md` documents the `gen` command and
 * `gen.go` is the generator. The past participle is safe after any separator,
 * since nothing names itself `generated` unless it is.
 */
const GENERATED_STEM = /[._-](?:generated|autogen)(?:$|[._-])|\.gen$/i;

const GENERATED_NAMES: ReadonlySet<string> = new Set([
  "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "composer.lock",
]);

/** Detect generated output from path conventions alone, without reading content. */
export function isGenerated(relativePath: string): boolean {
  const name = path.posix.basename(relativePath).toLowerCase();
  const directories = path.posix.dirname(relativePath).toLowerCase().split("/").filter((part) => part && part !== ".");
  if (containsAny(directories, GENERATED_DIRECTORIES)) return true;
  if (GENERATED_NAMES.has(name)) return true;
  if (GENERATED_SUFFIXES.some((suffix) => name.endsWith(suffix))) return true;
  return GENERATED_STEM.test(name.slice(0, name.length - path.posix.extname(name).length));
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
