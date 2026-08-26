import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { measureFile } from "../src/scanner/measure.ts";
import { StructureAnalyzer } from "../src/scanner/structure.ts";

/**
 * A sample file's expected measurement, beside the numbers `cloc` reported.
 *
 * `cloc` was used as a development-time oracle only. It is not a dependency of
 * this package, of this suite, or of CI, and nothing here invokes it: the
 * numbers below were recorded by hand from `cloc 2.00` and are now fixtures.
 * Recording them keeps a deliberate divergence honest, because a change that
 * quietly drifts away from the reference has to edit this table to pass.
 */
interface CorpusExpectation {
  /** The grammar that must produce the counts, or `null` for the marker path. */
  grammar: string | null;
  codeLines: number;
  commentLines: number;
  blankLines: number;
  /** What `cloc 2.00` reported for the same file. */
  cloc: { codeLines: number; commentLines: number; blankLines: number };
  /** Why we deliberately disagree with `cloc`. Required whenever we do. */
  divergence?: string;
}

/**
 * Reasons we knowingly differ from `cloc`, shared by every file they apply to.
 *
 * A divergence is only ever a line moving between the code bucket and the
 * comment bucket. The content total and the blank count are asserted equal to
 * `cloc` for every file in the corpus, including these.
 */
const SHEBANG_IS_COMMENT =
  "We count a `#!` line as comment on both paths. `cloc` restores it as code, but only for the languages in its own shebang table, so it calls the line code in a Bourne script and comment in a fish script.";
const HASH_COMMENTS_IN_INI =
  "`cloc` reads only `;` in an INI file. Every INI dialect in the wild accepts `#` as well, and config written that way is commentary.";
const UNTERMINATED_BLOCK_IS_COMMENT =
  "An unterminated block comment runs to the end of the file, which is what the compiler does with it. `cloc` leaves the text as code because its block pattern needs a closing delimiter.";
const COMPONENT_SCRIPT_COMMENTS =
  "`cloc` reads only HTML comments in a Svelte file, so `//` and block comments inside `<script>` count as code. A single-file component is script and style as much as markup, and we read all three.";

const CORPUS: Readonly<Record<string, CorpusExpectation>> = {
  // Shell family. The bash grammar covers every Bourne dialect we admit.
  "deploy.sh": { grammar: "bash", codeLines: 9, commentLines: 2, blankLines: 3, cloc: { codeLines: 10, commentLines: 1, blankLines: 3 }, divergence: SHEBANG_IS_COMMENT },
  "build.bash": { grammar: "bash", codeLines: 4, commentLines: 3, blankLines: 0, cloc: { codeLines: 5, commentLines: 2, blankLines: 0 }, divergence: SHEBANG_IS_COMMENT },
  "report.ksh": { grammar: "bash", codeLines: 6, commentLines: 2, blankLines: 2, cloc: { codeLines: 7, commentLines: 1, blankLines: 2 }, divergence: SHEBANG_IS_COMMENT },
  // `cloc 2.00` does not know `.bats`; measured with --force-lang="Bourne Again Shell,bats".
  "helpers.bats": { grammar: "bash", codeLines: 6, commentLines: 2, blankLines: 2, cloc: { codeLines: 7, commentLines: 1, blankLines: 2 }, divergence: SHEBANG_IS_COMMENT },
  // Fish uses `#` but is not Bourne shell, so it takes the marker path.
  "config.fish": { grammar: null, codeLines: 4, commentLines: 2, blankLines: 1, cloc: { codeLines: 4, commentLines: 2, blankLines: 1 } },

  // Stylesheets.
  "theme.css": { grammar: null, codeLines: 6, commentLines: 5, blankLines: 2, cloc: { codeLines: 6, commentLines: 5, blankLines: 2 } },
  "theme.scss": { grammar: null, codeLines: 5, commentLines: 2, blankLines: 1, cloc: { codeLines: 5, commentLines: 2, blankLines: 1 } },
  "mixins.less": { grammar: null, codeLines: 7, commentLines: 1, blankLines: 2, cloc: { codeLines: 7, commentLines: 1, blankLines: 2 } },
  "unterminated.less": { grammar: null, codeLines: 1, commentLines: 2, blankLines: 1, cloc: { codeLines: 3, commentLines: 0, blankLines: 1 }, divergence: UNTERMINATED_BLOCK_IS_COMMENT },

  // Markup and single-file components.
  "page.html": { grammar: null, codeLines: 9, commentLines: 5, blankLines: 1, cloc: { codeLines: 9, commentLines: 5, blankLines: 1 } },
  "feed.xml": { grammar: null, codeLines: 7, commentLines: 1, blankLines: 0, cloc: { codeLines: 7, commentLines: 1, blankLines: 0 } },
  "logo.svg": { grammar: null, codeLines: 3, commentLines: 1, blankLines: 0, cloc: { codeLines: 3, commentLines: 1, blankLines: 0 } },
  "Counter.vue": { grammar: null, codeLines: 12, commentLines: 3, blankLines: 3, cloc: { codeLines: 12, commentLines: 3, blankLines: 3 } },
  "Counter.svelte": { grammar: null, codeLines: 12, commentLines: 3, blankLines: 3, cloc: { codeLines: 14, commentLines: 1, blankLines: 3 }, divergence: COMPONENT_SCRIPT_COMMENTS },

  // C-family languages that ship no grammar here.
  "Widget.kt": { grammar: null, codeLines: 7, commentLines: 4, blankLines: 1, cloc: { codeLines: 7, commentLines: 4, blankLines: 1 } },
  "App.swift": { grammar: null, codeLines: 7, commentLines: 3, blankLines: 1, cloc: { codeLines: 7, commentLines: 3, blankLines: 1 } },
  "Pipeline.scala": { grammar: null, codeLines: 6, commentLines: 3, blankLines: 1, cloc: { codeLines: 6, commentLines: 3, blankLines: 1 } },
  "counter.dart": { grammar: null, codeLines: 7, commentLines: 3, blankLines: 2, cloc: { codeLines: 7, commentLines: 3, blankLines: 2 } },
  // `cloc 2.00` does not know `.jsonc`; measured with --force-lang="JSON5,jsonc".
  "tsconfig.jsonc": { grammar: null, codeLines: 8, commentLines: 4, blankLines: 0, cloc: { codeLines: 8, commentLines: 4, blankLines: 0 } },
  "schema.prisma": { grammar: null, codeLines: 8, commentLines: 2, blankLines: 1, cloc: { codeLines: 8, commentLines: 2, blankLines: 1 } },

  // Hash-marked configuration, including the formats named by filename alone.
  "pipeline.yaml": { grammar: null, codeLines: 7, commentLines: 2, blankLines: 1, cloc: { codeLines: 7, commentLines: 2, blankLines: 1 } },
  "settings.toml": { grammar: null, codeLines: 5, commentLines: 1, blankLines: 1, cloc: { codeLines: 5, commentLines: 1, blankLines: 1 } },
  "main.tf": { grammar: null, codeLines: 7, commentLines: 4, blankLines: 2, cloc: { codeLines: 7, commentLines: 4, blankLines: 2 } },
  "app.ini": { grammar: null, codeLines: 5, commentLines: 2, blankLines: 1, cloc: { codeLines: 6, commentLines: 1, blankLines: 1 }, divergence: HASH_COMMENTS_IN_INI },
  "app.properties": { grammar: null, codeLines: 3, commentLines: 2, blankLines: 0, cloc: { codeLines: 3, commentLines: 2, blankLines: 0 } },
  "analysis.r": { grammar: null, codeLines: 7, commentLines: 1, blankLines: 2, cloc: { codeLines: 7, commentLines: 1, blankLines: 2 } },
  "report.pl": { grammar: null, codeLines: 4, commentLines: 2, blankLines: 1, cloc: { codeLines: 5, commentLines: 1, blankLines: 1 }, divergence: SHEBANG_IS_COMMENT },
  "Dockerfile": { grammar: null, codeLines: 7, commentLines: 2, blankLines: 2, cloc: { codeLines: 7, commentLines: 2, blankLines: 2 } },
  "Makefile": { grammar: null, codeLines: 5, commentLines: 1, blankLines: 2, cloc: { codeLines: 5, commentLines: 1, blankLines: 2 } },
  // `cloc 2.00` does not know `.env`; measured with --force-lang="TOML,example".
  ".env.example": { grammar: null, codeLines: 4, commentLines: 2, blankLines: 1, cloc: { codeLines: 4, commentLines: 2, blankLines: 1 } },

  // Everything else.
  "init.lua": { grammar: null, codeLines: 8, commentLines: 5, blankLines: 3, cloc: { codeLines: 8, commentLines: 5, blankLines: 3 } },
  "report.sql": { grammar: null, codeLines: 6, commentLines: 3, blankLines: 0, cloc: { codeLines: 6, commentLines: 3, blankLines: 0 } },
  // Formats with no comment syntax, and one with no rule at all. All content is code.
  "manifest.json": { grammar: null, codeLines: 5, commentLines: 0, blankLines: 0, cloc: { codeLines: 5, commentLines: 0, blankLines: 0 } },
  "notes.md": { grammar: null, codeLines: 4, commentLines: 0, blankLines: 2, cloc: { codeLines: 4, commentLines: 0, blankLines: 2 } },
  "notice.txt": { grammar: null, codeLines: 2, commentLines: 0, blankLines: 1, cloc: { codeLines: 2, commentLines: 0, blankLines: 1 } },
};

const CORPUS_DIRECTORY = path.join(path.dirname(fileURLToPath(import.meta.url)), "corpus");
const analyzer = new StructureAnalyzer();

afterAll(() => {
  analyzer.dispose();
});

async function measure(fileName: string) {
  const text = await readFile(path.join(CORPUS_DIRECTORY, fileName), "utf8");
  return measureFile(analyzer, fileName, text);
}

describe("comment detection corpus", () => {
  it("measures every file in the corpus, so a new sample cannot be added without an expectation", async () => {
    const onDisk = (await readdir(CORPUS_DIRECTORY)).sort();
    expect(onDisk).toEqual(Object.keys(CORPUS).sort());
  });

  for (const [fileName, expected] of Object.entries(CORPUS)) {
    it(`splits ${fileName} into the recorded buckets`, async () => {
      const { grammar, lines } = await measure(fileName);
      expect(grammar).toBe(expected.grammar);
      expect({
        codeLines: lines.codeLines,
        commentLines: lines.commentLines,
        blankLines: lines.blankLines,
      }).toEqual({
        codeLines: expected.codeLines,
        commentLines: expected.commentLines,
        blankLines: expected.blankLines,
      });
    });
  }

  it("keeps the content total and the blank count identical to cloc for every file", async () => {
    // The whole point of the exercise: comment detection may only move a line
    // between code and comment. It may never change how many lines there are.
    for (const [fileName, expected] of Object.entries(CORPUS)) {
      const { lines } = await measure(fileName);
      expect({ file: fileName, content: lines.lines, blank: lines.blankLines }).toEqual({
        file: fileName,
        content: expected.cloc.codeLines + expected.cloc.commentLines,
        blank: expected.cloc.blankLines,
      });
    }
  });

  it("keeps lines equal to code plus comment for every file", async () => {
    for (const fileName of Object.keys(CORPUS)) {
      const { lines } = await measure(fileName);
      expect({ file: fileName, total: lines.lines }).toEqual({
        file: fileName,
        total: lines.codeLines + lines.commentLines,
      });
    }
  });

  it("never reports nothing for a file that has content", async () => {
    for (const fileName of Object.keys(CORPUS)) {
      const { lines } = await measure(fileName);
      expect({ file: fileName, empty: lines.lines === 0 }).toEqual({ file: fileName, empty: false });
    }
  });

  it("records a reason for every disagreement with cloc, and none where there is no disagreement", () => {
    // A silent drift toward or away from the reference has to edit this table.
    for (const [fileName, expected] of Object.entries(CORPUS)) {
      const agrees =
        expected.codeLines === expected.cloc.codeLines &&
        expected.commentLines === expected.cloc.commentLines;
      expect({ file: fileName, agrees, explained: expected.divergence !== undefined })
        .toEqual({ file: fileName, agrees, explained: !agrees });
    }
  });
});
