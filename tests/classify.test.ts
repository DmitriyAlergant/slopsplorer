import { afterAll, describe, expect, it } from "vitest";
import { classifyFile, isGenerated, isSourceFile, refineKindByContent, shebangInterpreter } from "../src/scanner/classify.ts";
import { measureFile } from "../src/scanner/measure.ts";
import { StructureAnalyzer } from "../src/scanner/structure.ts";

describe("file kind classification", () => {
  it("puts ordinary source, prose, and structured data in separate buckets so the visibility switches mean something", () => {
    expect(classifyFile("src/service.py")).toBe("code");
    expect(classifyFile("docs/design.md")).toBe("text");
    expect(classifyFile("config/models.yaml")).toBe("data");
  });

  it("recognises every common test-naming convention, not just one ecosystem's", () => {
    expect(classifyFile("tests/test_service.py")).toBe("test");
    expect(classifyFile("src/service.test.ts")).toBe("test");
    expect(classifyFile("src/service_test.go")).toBe("test");
    expect(classifyFile("spec/thing_spec.rb")).toBe("test");
  });

  it("counts unremarkably named source under a test directory as test code", () => {
    expect(classifyFile("tests/utils/websocket_client.py")).toBe("test");
    expect(classifyFile("tests/conftest.py")).toBe("test");
    expect(classifyFile("e2e/helpers.ts")).toBe("test");
  });

  it("lets a fixture keep the flavor of its own format, because a test directory is only a location", () => {
    // Sitting in tests/ is a weaker signal than the extension: a test tree holds
    // fixtures, corpora, and sample documents that are not test code, and calling
    // a 12k-token HTML blob "Tests" hides what the weight actually is.
    expect(classifyFile("tests/fixtures/events.json")).toBe("data");
    expect(classifyFile("__tests__/fixtures/users.yaml")).toBe("data");
    expect(classifyFile("frontend/tests/paste/msword_clipboard.html")).toBe("other");
    expect(classifyFile("tests/README.md")).toBe("text");
  });

  it("keeps a test-shaped filename ahead of its extension, wherever it sits", () => {
    expect(classifyFile("fixtures/test_payloads.json")).toBe("test");
    expect(classifyFile("data/events_test.yaml")).toBe("test");
  });

  it("treats a real language code as a translation catalogue", () => {
    expect(classifyFile("translations/de-DE.json")).toBe("i18n");
    expect(classifyFile("src/locales/en.yaml")).toBe("i18n");
    expect(classifyFile("assets/pt_BR.json")).toBe("i18n");
    expect(classifyFile("locale/messages.po")).toBe("i18n");
  });

  it("does not mistake short config filenames for language codes, which would hide config behind the i18n switch", () => {
    // Regression: matching any two-or-three letter stem misfiled these as i18n.
    expect(classifyFile("config/api.json")).toBe("data");
    expect(classifyFile("config/dev.yaml")).toBe("data");
    expect(classifyFile("src/db.yaml")).toBe("data");
  });

  it("classifies Python dependency manifests as configuration rather than prose", () => {
    expect(classifyFile("requirements.txt")).toBe("data");
    expect(classifyFile("deploy/requirements.txt")).toBe("data");
    expect(isGenerated("requirements.txt")).toBe(false);
  });

  it("falls back to `other` for extensions that are neither code, prose, nor data", () => {
    expect(classifyFile("scripts/query.sql")).toBe("code");
    expect(classifyFile("Cargo.lock")).toBe("other");
  });
});

describe("generated-output detection", () => {
  it("flags machine-written files from path conventions alone, so no file has to be read to be discounted", () => {
    expect(isGenerated("generated/client.gen.go")).toBe(true);
    expect(isGenerated("src/contracts.generated.ts")).toBe(true);
    expect(isGenerated("Cargo.lock")).toBe(true);
    expect(isGenerated("uv.lock")).toBe(true);
    expect(isGenerated("package-lock.json")).toBe(true);
    expect(isGenerated("dist/bundle.js")).toBe(true);
  });

  it("leaves hand-written source unflagged so the project baseline is not silently shrunk", () => {
    expect(isGenerated("src/service.py")).toBe(false);
    expect(isGenerated("src/scanner/classify.ts")).toBe(false);
    expect(isGenerated("docs/design.md")).toBe(false);
  });
});

describe("scan admission", () => {
  it("accepts readable source extensions and refuses vendored or cached directories", () => {
    expect(isSourceFile("src/service.py")).toBe(true);
    expect(isSourceFile("assets/logo.png")).toBe(false);
    expect(isSourceFile("node_modules/left-pad/index.js")).toBe(false);
    expect(isSourceFile("app/__pycache__/service.py")).toBe(false);
  });

  it("accepts the whole shell family, not just .sh", () => {
    for (const name of ["deploy.sh", "build.bash", "run.ksh", "unit.bats", "prompt.zsh", "config.fish"]) {
      expect({ name, admitted: isSourceFile(`scripts/${name}`) }).toEqual({ name, admitted: true });
    }
  });

  it("refuses a file with no extension, which is why a shebang alone cannot bring one into a scan", () => {
    // Recorded deliberately: `Dockerfile`, `Makefile`, and an extensionless
    // script are all outside the walker's reach, so shebang detection only
    // applies to a file that already earned its way into the listing.
    expect(isSourceFile("scripts/provision")).toBe(false);
    expect(isSourceFile("Dockerfile")).toBe(false);
    expect(isSourceFile("Makefile")).toBe(false);
  });
});

describe("shebang interpreter", () => {
  it("reads the interpreter through a direct path and through env", () => {
    expect(shebangInterpreter("#!/bin/bash\necho hi\n")).toBe("bash");
    expect(shebangInterpreter("#!/usr/bin/env bash\n")).toBe("bash");
    expect(shebangInterpreter("#!/usr/bin/env -S python3 -u\n")).toBe("python");
    expect(shebangInterpreter("#!/usr/bin/perl5.34 -w\n")).toBe("perl");
  });

  it("returns nothing when the first line is not a shebang, so an ordinary comment is not mistaken for one", () => {
    expect(shebangInterpreter("# just a comment\n")).toBeNull();
    expect(shebangInterpreter("")).toBeNull();
    expect(shebangInterpreter("echo hi\n#!/bin/sh\n")).toBeNull();
  });
});

describe("literal-heavy source re-filed by content", () => {
  /** A code file whose shape the three thresholds are read against. */
  function shape(overrides: Partial<Parameters<typeof refineKindByContent>[2]> = {}) {
    return { grammar: "typescript", contentChars: 10_000, literalChars: 9_500, largestLiteral: 100, ...overrides };
  }

  it("re-files a source module that is almost entirely string literals as data", () => {
    expect(refineKindByContent("code", "src/messages.ts", shape())).toBe("data");
  });

  it("sends a catalogue that names itself a translation table to i18n", () => {
    expect(refineKindByContent("code", "packages/desktop-host/src/desktop-i18n.ts", shape())).toBe("i18n");
    expect(refineKindByContent("code", "src/locale-strings.ts", shape())).toBe("i18n");
    expect(refineKindByContent("code", "src/translations.ts", shape())).toBe("i18n");
  });

  it("leaves a file holding one large embedded blob as code", () => {
    // An icon component's SVG path, or a template literal of injected script,
    // reaches a near-total literal share in a file that is unambiguously code.
    expect(refineKindByContent("code", "src/icons/Okta.tsx", shape({ largestLiteral: 9_000 }))).toBe("code");
  });

  it("exempts shell, which quotes nearly everything it touches", () => {
    expect(refineKindByContent("code", "platform/init/26_views.sh", shape({ grammar: "bash" }))).toBe("code");
    expect(refineKindByContent("code", "scripts/deploy.ps1", shape({ grammar: "powershell" }))).toBe("code");
  });

  it("ignores files too small or too mixed for the ratio to mean anything", () => {
    expect(refineKindByContent("code", "src/constants.ts", shape({ contentChars: 200, literalChars: 200 }))).toBe("code");
    expect(refineKindByContent("code", "src/service.ts", shape({ literalChars: 8_800 }))).toBe("code");
    expect(refineKindByContent("code", "src/service.kt", shape({ grammar: null }))).toBe("code");
  });

  it("never overrides a flavor that the path already settled", () => {
    // Content only refines code. A fixture, a doc, or a test keeps its flavor
    // however literal it reads, so the switches stay predictable.
    expect(refineKindByContent("test", "tests/test_messages.py", shape())).toBe("test");
    expect(refineKindByContent("data", "config/api.json", shape())).toBe("data");
  });
});

describe("literal measurement against real grammars", () => {
  const analyzer = new StructureAnalyzer();
  afterAll(() => { analyzer.dispose(); });

  /** Classify a file end to end, from its path and its parsed content. */
  async function classify(name: string, text: string): Promise<string> {
    const { grammar, structure } = await measureFile(analyzer, name, text);
    return refineKindByContent(classifyFile(name), name, { grammar, ...structure });
  }

  it("re-files a real translation catalogue and leaves ordinary code alone", async () => {
    const entries = Array.from({ length: 200 }, (_, index) => `  'app.key${index}': 'A user-facing message number ${index}',`);
    const catalogue = `export const messages = {\n${entries.join("\n")}\n};\n`;
    expect(await classify("desktop-i18n.ts", catalogue)).toBe("i18n");

    const module = Array.from({ length: 60 }, (_, index) => `export function step${index}(value: number): number {\n  if (value > ${index}) return value - ${index};\n  return value + ${index};\n}`).join("\n");
    expect(await classify("service.ts", module)).toBe("code");
  });

  it("counts a template literal once, including the expressions inside it", async () => {
    // The embedded script is one literal, so it dominates and the file stays code.
    const inner = Array.from({ length: 120 }, (_, index) => `  document.body.dataset.k${index} = 'v${index}';`).join("\n");
    const source = `const version = 3;\nexport const injected = \`\n${inner}\n  window.marker = \${version};\n\`;\n`;
    expect(await classify("browser-script.ts", source)).toBe("code");
  });

  it("does not count a Python docstring as a literal, since it is already commentary", async () => {
    const body = Array.from({ length: 80 }, (_, index) => `def step_${index}(value):\n    """Explain what step ${index} does at some length for the reader."""\n    return value + ${index}`).join("\n\n");
    expect(await classify("pipeline.py", body)).toBe("code");
  });
});
