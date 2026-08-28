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
 * ISO 639-1 codes, used to recognise a folder or a file named for a language.
 *
 * The whole standard, because the evidence that a name is a locale no longer
 * rests on this list alone. `isLocaleLevel` asks what the name sits beside, so
 * `brands/lg.json` stays a brand and `docker-compose/ga.yml` stays a compose
 * file, both of which a bare list of codes called translations.
 */
const LANGUAGE_CODES: ReadonlySet<string> = new Set([
  "aa", "ab", "ae", "af", "ak", "am", "an", "ar", "as", "av", "ay", "az", "ba",
  "be", "bg", "bh", "bi", "bm", "bn", "bo", "br", "bs", "ca", "ce", "ch", "co",
  "cr", "cs", "cu", "cv", "cy", "da", "de", "dv", "dz", "ee", "el", "en", "eo",
  "es", "et", "eu", "fa", "ff", "fi", "fil", "fj", "fo", "fr", "fy", "ga", "gd",
  "gl", "gn", "gu", "gv", "ha", "he", "hi", "ho", "hr", "ht", "hu", "hy", "hz",
  "ia", "id", "ie", "ig", "ii", "ik", "io", "is", "it", "iu", "ja", "jv", "ka",
  "kg", "ki", "kj", "kk", "kl", "km", "kn", "ko", "kr", "ks", "ku", "kv", "kw",
  "ky", "la", "lb", "lg", "li", "ln", "lo", "lt", "lu", "lv", "mg", "mh", "mi",
  "mk", "ml", "mn", "mr", "ms", "mt", "my", "na", "nb", "nd", "ne", "ng", "nl",
  "nn", "no", "nr", "nv", "ny", "oc", "oj", "om", "or", "os", "pa", "pi", "pl",
  "ps", "pt", "qu", "rm", "rn", "ro", "ru", "rw", "sa", "sc", "sd", "se", "sg",
  "si", "sk", "sl", "sm", "sn", "so", "sq", "sr", "ss", "st", "su", "sv", "sw",
  "ta", "te", "tg", "th", "ti", "tk", "tl", "tn", "to", "tr", "ts", "tt", "tw",
  "ty", "ug", "uk", "ur", "uz", "ve", "vi", "wa", "wo", "xh", "yi", "yo", "za",
  "zh", "zu",
]);

/** Whether any member of `candidates` is in `known`. */
function containsAny(candidates: Iterable<string>, known: ReadonlySet<string>): boolean {
  for (const candidate of candidates) {
    if (known.has(candidate)) return true;
  }
  return false;
}

/**
 * ISO 3166-1 alpha-2 regions, plus the scripts that appear where a region does.
 *
 * Curated for the same reason the language codes are, and measured: a rule that
 * took any short suffix read `no_log`, `no_ip`, `no-tty`, and `hi_kumo` as
 * locales, because `no` and `hi` are languages and the rest is a word.
 */
const REGION_CODES: ReadonlySet<string> = new Set([
  "ad", "ae", "af", "ag", "ai", "al", "am", "ao", "ar", "at", "au", "aw", "az",
  "ba", "bb", "bd", "be", "bf", "bg", "bh", "bi", "bj", "bm", "bn", "bo", "br",
  "bs", "bt", "bw", "by", "bz", "ca", "cd", "cf", "cg", "ch", "ci", "cl", "cm",
  "cn", "co", "cr", "cu", "cv", "cy", "cz", "de", "dj", "dk", "dm", "do", "dz",
  "ec", "ee", "eg", "er", "es", "et", "fi", "fj", "fm", "fo", "fr", "ga", "gb",
  "gd", "ge", "gh", "gm", "gn", "gq", "gr", "gt", "gw", "gy", "hk", "hn", "hr",
  "ht", "hu", "id", "ie", "il", "in", "iq", "ir", "is", "it", "jm", "jo", "jp",
  "ke", "kg", "kh", "ki", "km", "kn", "kp", "kr", "kw", "ky", "kz", "la", "lb",
  "lc", "li", "lk", "lr", "ls", "lt", "lu", "lv", "ly", "ma", "mc", "md", "me",
  "mg", "mh", "mk", "ml", "mm", "mn", "mo", "mr", "mt", "mu", "mv", "mw", "mx",
  "my", "mz", "na", "ne", "ng", "ni", "nl", "no", "np", "nz", "om", "pa", "pe",
  "pg", "ph", "pk", "pl", "pr", "ps", "pt", "py", "qa", "ro", "rs", "ru", "rw",
  "sa", "sb", "sc", "sd", "se", "sg", "si", "sk", "sl", "sm", "sn", "so", "sr",
  "ss", "sv", "sy", "sz", "td", "tg", "th", "tj", "tm", "tn", "to", "tr", "tt",
  "tw", "tz", "ua", "ug", "us", "uy", "uz", "ve", "vn", "vu", "ws", "ye", "za",
  "zm", "zw",
  "arab", "cyrl", "hans", "hant", "latn",
]);

/** `en`, `de-DE`, `pt_BR`, `sr_Latn` - the shape of a locale name. */
const LOCALE_NAME = /^([a-z]{2,3})(?:[-_]([a-z]{2,4}))?$/;

/** Whether the name is a language code, with a real region or script if it carries one. */
function isLocaleName(name: string): boolean {
  const match = LOCALE_NAME.exec(name);
  if (match === null || !LANGUAGE_CODES.has(match[1]!)) return false;
  const region = match[2];
  return region === undefined || REGION_CODES.has(region);
}

/**
 * `zh-cn`, `pt_BR`, `en-US`, `sr_Latn` - a language code carrying a region or
 * a script, both of them real codes.
 *
 * This is the one locale name that needs no other evidence. `en` is a name
 * anything could use, but nothing writes `zh-cn` unless it means Chinese as
 * written in China.
 */
function isRegionedLocale(name: string): boolean {
  const match = LOCALE_NAME.exec(name);
  return match !== null && match[2] !== undefined && isLocaleName(name);
}

/** Entries that must be language codes before a folder reads as a locale level. */
const MIN_LOCALE_ENTRIES = 2;

/** The share of a locale level's entries that must be codes the list knows. */
const LOCALE_LEVEL_SHARE = 0.9;

/**
 * Whether one folder holds one entry per language.
 *
 * Two kinds of evidence, and either is enough. The folder is named for
 * translation, as `locales/` is. Or its entries say so themselves: nearly all
 * of them are language codes and every one of them is at least shaped like a
 * locale, which is what a folder of translated documentation looks like from
 * the outside.
 *
 * The homogeneity is what makes the second test safe. Both halves were
 * measured. vscode keeps 107 shell completions in one folder, three of which
 * are `tr`, `nl`, and `sr`; hugo names its comparison functions `Lt.md` and
 * `Ne.md` beside `Conditional.md`. A folder that is mostly locales holds
 * nothing else.
 */
function isLocaleLevel(directory: string, entries: ReadonlySet<string>): boolean {
  if (I18N_DIRECTORIES.has(directory.slice(directory.lastIndexOf("/") + 1))) return true;
  let known = 0;
  for (const entry of entries) {
    if (!LOCALE_NAME.test(entry)) return false;
    if (isLocaleName(entry)) known += 1;
  }
  return known >= MIN_LOCALE_ENTRIES && known >= entries.size * LOCALE_LEVEL_SHARE;
}

/**
 * The folders of a tree that hold one entry per language.
 *
 * A locale name on its own says very little: `en` and `id` are folder names
 * anything could use. What settles it is what the name sits beside, so this
 * reads the whole listing once and answers that question for every folder.
 * Both producers of an index build this from the same view of the tree, so a
 * scan and a comparison never disagree about a file.
 */
export function findLocaleLevels(relativePaths: readonly string[]): ReadonlySet<string> {
  const entriesByDirectory = new Map<string, Set<string>>();
  const record = (directory: string, entry: string): void => {
    const entries = entriesByDirectory.get(directory);
    if (entries === undefined) entriesByDirectory.set(directory, new Set([entry]));
    else entries.add(entry);
  };

  for (const relativePath of relativePaths) {
    const segments = relativePath.toLowerCase().split("/").filter((segment) => segment && segment !== ".");
    const name = segments[segments.length - 1];
    if (name === undefined) continue;
    const directories = segments.slice(0, -1);
    for (let depth = 0; depth < directories.length; depth += 1) {
      record(directories.slice(0, depth).join("/"), directories[depth]!);
    }
    const extension = path.posix.extname(name);
    record(directories.join("/"), name.slice(0, name.length - extension.length));
  }

  const levels = new Set<string>();
  for (const [directory, entries] of entriesByDirectory) {
    if (isLocaleLevel(directory, entries)) levels.add(directory);
  }
  return levels;
}

/**
 * Whether the file is one language's copy of something.
 *
 * A region or a script settles it wherever the name sits, which is what
 * reaches a documentation site that keeps `content/zh-cn/` beside
 * `content/en/`. A bare code needs the folder it sits in to be a level of
 * languages, which is what tells `locales/en.json` from `config/en.json` and
 * `conf/locale/nl/formats.py` from `src/id/resolver.ts`.
 */
function isLocaleCopy(directories: readonly string[], stem: string, localeLevels: ReadonlySet<string>): boolean {
  if (isRegionedLocale(stem)) return true;
  for (let depth = 0; depth < directories.length; depth += 1) {
    const directory = directories[depth]!;
    if (isRegionedLocale(directory)) return true;
    if (isLocaleName(directory) && localeLevels.has(directories.slice(0, depth).join("/"))) return true;
  }
  return isLocaleName(stem) && localeLevels.has(directories.join("/"));
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
export function classifyFile(relativePath: string, localeLevels: ReadonlySet<string>): FileKind {
  const name = path.posix.basename(relativePath);
  const lowercasedName = name.toLowerCase();
  const extension = path.posix.extname(lowercasedName);
  const stem = lowercasedName.slice(0, lowercasedName.length - extension.length);
  const directories = path.posix.dirname(relativePath).toLowerCase().split("/").filter((part) => part && part !== ".");

  if (extension === ".po" || extension === ".pot") return "i18n";
  if (isTestFileName(lowercasedName)) return "test";
  if (isLocaleCopy(directories, stem, localeLevels)) return "i18n";
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

/**
 * A line that opens or continues a comment, in any language a scan reads.
 *
 * The anchor is what makes the marker below safe. Unanchored, `@generated`
 * also matches TypeORM's `@Generated()` column decorator and a Ruby
 * `@generated` instance variable, neither of which is a generated file.
 */
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*|#|--|<!--|;|"""|''')/;

/**
 * What a generator writes at the top of the file it wrote.
 *
 * Every phrasing here was read off a real header: `Code generated by
 * Microsoft (R) AutoRest Code Generator.`, `AUTOGENERATED BY ...`,
 * `AUTO-GENERATED by scripts/generate-emoji-data.mjs - DO NOT EDIT`,
 * `This file is automatically generated by ...`, `@generated`, and Go's
 * `Code generated by "stringer"; DO NOT EDIT.`.
 *
 * `rendered` was measured and left out. It reads like a generator marker, but
 * across 21 repositories it only ever matched prose about a component being
 * rendered by something else.
 */
const GENERATED_HEADER = /@generated|code generated by|(?:auto[- ]?|automatically )generated(?:\s+by|.{0,80}?do not edit)|do not edit.{0,80}?generated/i;

/** How far into a file the marker may sit. A header is a header. */
const GENERATED_HEADER_LINES = 8;

/** How much of the head to read, so one minified line cannot cost a scan. */
const GENERATED_HEADER_CHARS = 2000;

/**
 * Whether the file says a tool wrote it.
 *
 * The path is silent for a whole class of generated code: an SDK whose client
 * is emitted from a service specification sits in ordinary `src/` folders
 * under ordinary names, and only the header it carries says what it is. That
 * is 11% of Azure's JavaScript SDK.
 */
export function hasGeneratedHeader(text: string): boolean {
  const head = text.slice(0, GENERATED_HEADER_CHARS).split("\n", GENERATED_HEADER_LINES);
  return head.some((line) => COMMENT_LINE.test(line) && GENERATED_HEADER.test(line));
}

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
