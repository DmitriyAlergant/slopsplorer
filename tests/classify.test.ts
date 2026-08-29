import { afterAll, describe, expect, it } from "vitest";
import { classifyFile, findLocaleLevels, hasGeneratedContent, isGenerated, isSourceFile, refineKindByContent, shebangInterpreter } from "../src/scanner/classify.ts";
import { measureFile } from "../src/scanner/measure.ts";
import { StructureAnalyzer } from "../src/scanner/structure.ts";

/**
 * Classify one path against the tree it sits in.
 *
 * A locale name means little on its own, so classification reads the listing
 * to see what a folder holds. A test that does not care passes the one path,
 * which is a tree of one file.
 */
function classify(relativePath: string, tree: readonly string[] = [relativePath]): string {
  return classifyFile(relativePath, findLocaleLevels(tree));
}

describe("file kind classification", () => {
  it("puts ordinary source, prose, and structured data in separate buckets so the visibility switches mean something", () => {
    expect(classify("src/service.py")).toBe("code");
    expect(classify("docs/design.md")).toBe("text");
    expect(classify("config/models.yaml")).toBe("data");
  });

  it("reads the extensionless documentation names maintained by Linguist as prose", () => {
    for (const name of ["README", "CHANGELOG", "CHANGES", "CITATION", "CONTRIBUTING", "COPYING", "LICENSE", "LICENCE"]) {
      expect({ name, kind: classify(name), admitted: isSourceFile(name) }).toEqual({
        name,
        kind: "text",
        admitted: true,
      });
    }
  });

  it("recognises every common test-naming convention, not just one ecosystem's", () => {
    expect(classify("tests/test_service.py")).toBe("test");
    expect(classify("src/service.test.ts")).toBe("test");
    expect(classify("src/service_test.go")).toBe("test");
    expect(classify("spec/thing_spec.rb")).toBe("test");
  });

  it("reads the camel-case suffix the JVM and .NET name a test with", () => {
    // okhttp and PowerShell: `*Test.kt` and `*Tests.cs` are how a whole
    // ecosystem names a test, and neither ends in a separator.
    expect(classify("okhttp/src/jvmTest/kotlin/okhttp3/CallTest.kt")).toBe("test");
    expect(classify("src/HttpUrlTests.cs")).toBe("test");
    expect(classify("src/main/kotlin/RouterSpec.kt")).toBe("test");
    expect(classify("okhttp/src/jvmTest/kotlin/okhttp3/JSSETest.kt")).toBe("test");
  });

  it("reads the separated suffix in the forms other ecosystems write it", () => {
    expect(classify("tools/packaging/releaseTests/sbom.tests.ps1")).toBe("test");
    expect(classify("packages-private/dts-test/defineComponent.test-d.tsx")).toBe("test");
    expect(classify("crates/core/glob-spec.rs")).toBe("test");
  });

  it("does not read a suffix that only looks like one, which would hide real source", () => {
    // Measured on PowerShell and vue: the camel rule needs the capital letter,
    // and the separated rule needs the separator. Without both, the whole
    // engine/ tree of a shell and every `latest.ts` reads as a test.
    expect(classify("src/System.Management.Automation/engine/SpecialVariables.cs")).toBe("code");
    expect(classify("src/System.Management.Automation/engine/Modules/ModuleSpecification.cs")).toBe("code");
    expect(classify("commands/management/TestConnectionCommand.cs")).toBe("code");
    expect(classify("packages/runtime-core/src/latest.ts")).toBe("code");
  });

  it("keeps the broad suffix away from formats where it describes tests instead of being one", () => {
    // Every one of these was called test code by the suffix rule before it was
    // limited to source: CI configuration, prose about testing, and a
    // deployment specification are none of them test code.
    expect(classify(".github/workflows/tests.yml")).toBe("data");
    expect(classify(".vsts-ci/sshremoting-tests.yml")).toBe("data");
    expect(classify("docs/internals/contributing/writing-code/unit-tests.txt")).toBe("text");
    expect(classify("docs/testing-guidelines/WritingPesterTests.md")).toBe("text");
    expect(classify(".pipelines/EV2Specs/ServiceGroupRoot/RolloutSpec.json")).toBe("data");
  });

  it("recognises the Gradle and Kotlin Multiplatform test source sets", () => {
    // okhttp keeps a third of its weight under `jvmTest`, and none of these
    // names is the word `test` on its own.
    expect(classify("okhttp/src/jvmTest/kotlin/okhttp3/internal/http2/Hpack.kt")).toBe("test");
    expect(classify("okhttp/src/commonTest/kotlin/okhttp3/Helpers.kt")).toBe("test");
    expect(classify("android-test/src/androidTest/java/okhttp/Fixtures.kt")).toBe("test");
    expect(classify("lib/src/testFixtures/kotlin/Support.kt")).toBe("test");
  });

  it("does not accept a directory that merely ends in the word, which would swallow ordinary source", () => {
    // Why the directory list is curated rather than a suffix pattern.
    expect(classify("superset/db_engine_specs/bigquery.py")).toBe("code");
    expect(classify("superset-frontend/plugins/plugin-chart-paired-t-test/src/transformProps.ts")).toBe("code");
    expect(classify("activesupport/lib/active_support/testing/assertions.rb")).toBe("code");
  });

  it("counts unremarkably named source under a test directory as test code", () => {
    expect(classify("tests/utils/websocket_client.py")).toBe("test");
    expect(classify("tests/conftest.py")).toBe("test");
    expect(classify("e2e/helpers.ts")).toBe("test");
  });

  it("lets a fixture keep the flavor of its own format, because a test directory is only a location", () => {
    // Sitting in tests/ is a weaker signal than the extension: a test tree holds
    // fixtures, corpora, and sample documents that are not test code, and calling
    // a 12k-token HTML blob "Tests" hides what the weight actually is.
    expect(classify("tests/fixtures/events.json")).toBe("data");
    expect(classify("__tests__/fixtures/users.yaml")).toBe("data");
    expect(classify("frontend/tests/paste/msword_clipboard.html")).toBe("other");
    expect(classify("tests/README.md")).toBe("text");
  });

  it("reads a prose extension inside a fixture folder as the payload it is", () => {
    // Two `.txt` fixtures are 13% of neovim, and calling them documentation
    // says something false about the whole tree.
    expect(classify("test/functional/fixtures/bigfile.txt")).toBe("data");
    expect(classify("hugolib/testdata/what-is-markdown.md")).toBe("data");
    expect(classify("tests/gis_tests/data/rasters/raster.numpy.txt")).toBe("data");
    expect(classify("docs/design.md")).toBe("text");
  });

  it("keeps a test-shaped filename ahead of its extension, wherever it sits", () => {
    expect(classify("fixtures/test_payloads.json")).toBe("test");
    expect(classify("data/events_test.yaml")).toBe("test");
  });

  it("treats a real language code as a translation catalogue", () => {
    expect(classify("translations/de-DE.json")).toBe("i18n");
    expect(classify("src/locales/en.yaml")).toBe("i18n");
    expect(classify("assets/pt_BR.json")).toBe("i18n");
    expect(classify("locale/messages.po")).toBe("i18n");
  });

  it("leaves the machinery of translation as the code it is, rather than as a catalogue", () => {
    // A translation tree holds the code that reads the catalogues beside the
    // catalogues. Measured on PowerShell, hugo, Laravel, django, and superset:
    // the directory rule alone filed a shell's whole language engine, three
    // i18n implementations, and a release script under the i18n switch.
    expect(classify("src/System.Management.Automation/engine/lang/parserutils.cs")).toBe("code");
    expect(classify("langs/i18n/i18n.go")).toBe("code");
    expect(classify("src/Illuminate/Translation/Translator.php")).toBe("code");
    expect(classify("scripts/translations/backfill_po.py")).toBe("code");
    expect(classify("tests/i18n/tests.py")).toBe("test");
    expect(classify("docs/topics/i18n/translation.txt")).toBe("text");
    expect(classify("docs/content/en/functions/lang/Translate.md")).toBe("text");
  });

  it("still reads a translation directory as what tells a catalogue from ordinary configuration", () => {
    expect(classify("docs/i18n/en/code.json")).toBe("i18n");
    expect(classify("frontend/src/locales/fr.yaml")).toBe("i18n");
    expect(classify("config/api.json")).toBe("data");
    // Both measured against the full ISO 639-1 list: `lg` is Luganda and `ga`
    // is Irish, and neither file is a translation of anything.
    expect(classify("homeassistant/brands/lg.json", ["homeassistant/brands/lg.json", "homeassistant/brands/sony.json"])).toBe("data");
    expect(classify("scripts/ci/docker-compose/ga.yml")).toBe("data");
  });

  it("reads a whole language folder of a translation tree as catalogue, whatever format it holds", () => {
    expect(classify("django/conf/locale/nl/formats.py")).toBe("i18n");
    expect(classify("django/conf/locale/sr_Latn/formats.py")).toBe("i18n");
    expect(classify("src/Illuminate/Translation/lang/en/validation.php")).toBe("i18n");
    // Both halves are needed: a language folder outside a translation tree is
    // any two-letter folder, and a translation tree also holds its own source.
    expect(classify("src/id/resolver.ts")).toBe("code");
    expect(classify("langs/i18n/i18n.go")).toBe("code");
  });

  it("takes a region or a script as locale enough on its own, wherever it sits on the path", () => {
    // A documentation site keeps `content/zh-cn/` beside `content/en/`, with no
    // folder named i18n anywhere above them.
    expect(classify("content/zh-cn/docs/concepts/overview.md")).toBe("i18n");
    expect(classify("content/pt-br/docs/setup/_index.md")).toBe("i18n");
    expect(classify(".pipelines/store/PDP/en-US/PDP.xml")).toBe("i18n");
  });

  it("reads legacy aliases and a script plus a region as locale names", () => {
    expect(classify("content/zh-Hant-TW/docs/overview.md")).toBe("i18n");
    expect(classify("src/messages/az_Arab_IQ.json")).toBe("i18n");
    expect(classify("legacy/iw_IL/messages.json")).toBe("i18n");
    expect(classify("legacy/in_ID/messages.json")).toBe("i18n");
  });

  it("reads a bare language name as a locale only when it sits in a level of languages", () => {
    // A documentation site keeps content/en beside content/ja and content/pl,
    // with no folder named i18n anywhere above them.
    const site = [
      "content/en/docs/setup.md", "content/ja/docs/setup.md",
      "content/pl/docs/setup.md", "content/ko/docs/setup.md",
    ];
    for (const page of site) expect({ page, kind: classify(page, site) }).toEqual({ page, kind: "i18n" });
    expect(classify("content/en/docs/setup.md")).toBe("text");
  });

  it("reads a level of language-named files too, whatever format they are written in", () => {
    const catalogue = ["skills/translations/de.md", "skills/translations/el.md", "skills/translations/fr.md"];
    expect(classify("skills/translations/de.md", catalogue)).toBe("i18n");
    const errors = ["data/error-locale/el-GR.txt", "data/error-locale/hu-HU.txt"];
    expect(classify("data/error-locale/el-GR.txt", errors)).toBe("i18n");
  });

  it("wants the level to be all locales, not merely to contain a few", () => {
    // Both measured: vscode keeps 107 shell completions in one folder, three
    // named `tr`, `nl`, and `sr`; hugo names comparison functions `Lt.md` and
    // `Ne.md` beside `Conditional.md`.
    const completions = ["u/tr.ts", "u/nl.ts", "u/sr.ts", "u/cat.ts", "u/chmod.ts", "u/brew.ts", "u/apt.ts"];
    expect(classify("u/tr.ts", completions)).toBe("code");
    const functions = ["compare/Lt.md", "compare/Ne.md", "compare/Conditional.md", "compare/Default.md"];
    expect(classify("compare/Lt.md", functions)).toBe("text");
  });

  it("still takes a folder named for translation as a level, however few languages it holds", () => {
    // A framework that ships one language only still ships a catalogue.
    expect(classify("activesupport/lib/active_support/locale/en.rb")).toBe("i18n");
    expect(classify("src/locales/en.yaml")).toBe("i18n");
  });

  it("checks the region against a real list, because a language code plus a word is a common folder name", () => {
    // Measured: `no` and `hi` are languages, so a rule that took any short
    // suffix read all of these as locales. They are Ansible's no-log flag,
    // Home Assistant's No-IP and Hitachi Kumo integrations.
    expect(classify("test/integration/targets/no_log/tasks/main.yml")).toBe("data");
    expect(classify("homeassistant/components/no_ip/config_flow.py")).toBe("code");
    expect(classify("homeassistant/components/hi_kumo/sensor.py")).toBe("code");
  });

  it("does not mistake short config filenames for language codes, which would hide config behind the i18n switch", () => {
    // Regression: matching any two-or-three letter stem misfiled these as i18n.
    expect(classify("config/api.json")).toBe("data");
    expect(classify("config/dev.yaml")).toBe("data");
    expect(classify("src/db.yaml")).toBe("data");
  });

  it("classifies Python dependency manifests as configuration rather than prose", () => {
    expect(classify("requirements.txt")).toBe("data");
    expect(classify("deploy/requirements.txt")).toBe("data");
    expect(isGenerated("requirements.txt")).toBe(false);
  });

  it("reads a stylesheet as `other`, because presentation is not logic", () => {
    // A stylesheet is hand-written source, and so is the markup it dresses. One
    // could not be code while the other is not: neither holds logic to reason
    // about, and both are read for what they render.
    expect(classify("src/web/styles.css")).toBe("other");
    expect(classify("app/assets/stylesheets/main.scss")).toBe("other");
    // A test folder applies to code extensions only, exactly as it does for the
    // HTML beside it.
    expect(classify("tests/e2e/fixtures/page.css")).toBe("other");
  });

  it("falls back to `other` for extensions that are neither code, prose, nor data", () => {
    expect(classify("scripts/query.sql")).toBe("code");
    expect(classify("Cargo.lock")).toBe("other");
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

  it("flags generator-owned .NET and Yarn files by their upstream conventions", () => {
    expect(isGenerated("src/Settings.Designer.cs")).toBe(true);
    expect(isGenerated("features/Login.feature.cs")).toBe(true);
    expect(isGenerated(".pnp.cjs")).toBe(true);
    expect(isGenerated(".pnp.loader.mjs")).toBe(true);
    expect(isGenerated("npm-shrinkwrap.json")).toBe(true);
    expect(isGenerated("src/feature.cs")).toBe(false);
  });

  it("reads the content hash a bundler writes into an asset name, so a front-end build is caught wherever it was written", () => {
    // Webpack and Create React App write a hex digest, Vite and Rollup a
    // base64url one, and SvelteKit puts the same name under its own folder.
    expect(isGenerated("build/static/js/main.073c9b0a.js")).toBe(true);
    expect(isGenerated("build/static/css/main.5f361e03.css")).toBe(true);
    expect(isGenerated("build/static/js/2.f1e2d3c4.chunk.js")).toBe(true);
    expect(isGenerated("public/assets/index-DkR3sT1a.js")).toBe(true);
    expect(isGenerated("build/_app/immutable/chunks/index.B7v3JqLp.js")).toBe(true);
    expect(isGenerated("out/_next/static/chunks/main-1f8a4c92.js")).toBe(true);
    // A Vite digest often carries no digit at all, so the base64url half asks
    // for mixed case and nothing more.
    expect(isGenerated("assets/index-DEOvegEp.js")).toBe(true);
    expect(isGenerated("assets/styles-DNMy6jt0.css")).toBe(true);
    expect(isGenerated("static/js/vendor.min.js")).toBe(true);
    expect(isGenerated("static/css/app.chunk.css")).toBe(true);
  });

  it("keeps the hash rule off names that only look like a digest, which is why it needs a letter, a digit, and a bundler format", () => {
    // A dated migration is eight hex characters, and `deadbeef` is eight
    // letters. Both were flagged before the rule asked for one of each.
    expect(isGenerated("migrations/schema-20240101.sql")).toBe(false);
    expect(isGenerated("src/fixtures/token-deadbeef.js")).toBe(false);
    // The rule reads a bundler format only, so an ordinary module keeps its
    // suffix whatever it looks like.
    expect(isGenerated("src/components/Button-V2Alpha1x.tsx")).toBe(false);
    expect(isGenerated("src/use-local-storage.js")).toBe(false);
    expect(isGenerated("src/web/styles.css")).toBe(false);
    // The first segment of a stem is the name a person chose, and it is never
    // read as a hash: a PascalCase component is mixed case and long enough.
    expect(isGenerated("src/components/MyComponent.js")).toBe(false);
    expect(isGenerated("src/ScrollArea.css")).toBe(false);
  });

  it("reads the generated marker as a dot segment, whatever language wrote the file", () => {
    // neovim, PowerShell, and hugo each spell it differently, and listing one
    // suffix for each language missed 400k tokens of generated output.
    expect(isGenerated("runtime/lua/vim/_meta/vimfn.gen.lua")).toBe(true);
    expect(isGenerated("engine/interpreter/CallInstruction.Generated.cs")).toBe(true);
    expect(isGenerated("cimSupport/xml/cmdlets-over-objects.xmlSerializer.autogen.cs")).toBe(true);
    expect(isGenerated("resources/page/page_marshaljson.autogen.go")).toBe(true);
    expect(isGenerated("pkg/apis/core/v1/zz_generated.deepcopy.go")).toBe(true);
    expect(isGenerated("internal/warpc/js/renderkatex.bundle.js")).toBe(true);
  });

  it("leaves the generator itself unflagged, which is why `gen` needs the dot", () => {
    expect(isGenerated("docs/content/en/commands/hugo_gen.md")).toBe(false);
    expect(isGenerated("internal/tools/gen.go")).toBe(false);
    expect(isGenerated("tools/codegen.py")).toBe(false);
  });

  it("leaves hand-written source unflagged so the project baseline is not silently shrunk", () => {
    expect(isGenerated("src/service.py")).toBe(false);
    expect(isGenerated("src/scanner/classify.ts")).toBe(false);
    expect(isGenerated("docs/design.md")).toBe(false);
  });
});

describe("generated content", () => {
  it("reads the marker a generator writes, in the phrasings real generators use", () => {
    // The path is silent for a generated SDK client: it sits in an ordinary
    // src/ folder under an ordinary name, and only the header says what it is.
    expect(hasGeneratedContent("src/client.ts", " * Code generated by Microsoft (R) AutoRest Code Generator.\n")).toBe(true);
    expect(hasGeneratedContent("src/client.ts", '// Code generated by "stringer -type state"; DO NOT EDIT.\n')).toBe(true);
    expect(hasGeneratedContent("src/client.ts", "// AUTOGENERATED BY @DESIGN-ENGINEERING\n")).toBe(true);
    expect(hasGeneratedContent("src/client.ts", "// AUTO-GENERATED by scripts/generate-emoji-data.mjs - DO NOT EDIT\n")).toBe(true);
    expect(hasGeneratedContent("src/client.ts", "# Automatically generated by gen_requirements_all.py, do not edit\n")).toBe(true);
    expect(hasGeneratedContent("src/client.ts", "/* @generated */\n")).toBe(true);
    expect(hasGeneratedContent("src/client.ts", "// <auto-generated />\n")).toBe(true);
    expect(hasGeneratedContent("src/client.ts", "// Generated by the protocol buffer compiler. DO NOT EDIT!\n")).toBe(true);
    expect(hasGeneratedContent("src/client.ts", "// This file was mechanically generated.\n")).toBe(true);
    expect(hasGeneratedContent("src/client.ts", "// Any modifications to this file will be lost.\n")).toBe(true);
    expect(hasGeneratedContent("src/client.ts", "// GENERATED CODE - DO NOT MODIFY\n")).toBe(true);
  });

  it("reads an HTML generator meta tag in either attribute order", () => {
    expect(hasGeneratedContent("site/index.html", '<html><head><meta name="generator" content="Doxygen 1.9"></head></html>\n')).toBe(true);
    expect(hasGeneratedContent("site/index.html", "<html><head><meta content='org mode' name='generator'></head></html>\n")).toBe(true);
    expect(hasGeneratedContent("site/index.html", "<html><head><meta name='author' content='Human'></head></html>\n")).toBe(false);
  });

  it("finds the marker under a licence banner, and not past the head of the file", () => {
    const banner = "/*---\n * Copyright (c) Microsoft Corporation.\n * Licensed under the MIT License.\n *---*/\n\n";
    expect(hasGeneratedContent("src/client.ts", `${banner}// this file is automatically generated. Do not edit it.\n`)).toBe(true);
    const buried = `${"// a line of preamble\n".repeat(12)}// Code generated by tool\n`;
    expect(hasGeneratedContent("src/client.ts", buried)).toBe(false);
  });

  it("keeps ownership markers when a warning or copyright notice opens the comment", () => {
    expect(hasGeneratedContent("src/client.ts", "// WARNING: This file is automatically generated by schema-tool. Do not edit.\n")).toBe(true);
    expect(hasGeneratedContent("src/client.ts", "// NOTE: AUTO-GENERATED by schema-tool. DO NOT EDIT.\n")).toBe(true);
    expect(hasGeneratedContent("src/client.ts", "// Copyright 2026. Code generated by schema-tool.\n")).toBe(true);
  });

  it("only reads the marker inside a comment, so ordinary code that says the word is left alone", () => {
    // Both measured on real repositories: TypeORM's column decorator and a Ruby
    // instance variable are not generated files.
    expect(hasGeneratedContent("src/client.ts", "@Generated()\ncolumn: number;\n")).toBe(false);
    expect(hasGeneratedContent("src/client.ts", "def initialize\n  @generated = true\nend\n")).toBe(false);
    expect(hasGeneratedContent("src/client.ts", "// Compact button, rendered by NewSessionActionViewItem\n")).toBe(false);
    expect(hasGeneratedContent("src/client.ts", "// Code generated at runtime for the preview below.\n")).toBe(false);
    expect(hasGeneratedContent("src/client.ts", "// This ID is generated by the server.\n")).toBe(false);
    expect(hasGeneratedContent("src/client.ts", "// Automatically generated values are cached here.\nexport const cache = new Map();\n")).toBe(false);
    expect(hasGeneratedContent("src/client.ts", "// Generated by multiplying the source values.\nexport const values = source.map((value) => value * 2);\n")).toBe(false);
    expect(hasGeneratedContent("src/client.ts", "// This module is generated at runtime for previews.\nexport function preview() {}\n")).toBe(false);
    expect(hasGeneratedContent("src/client.ts", "// TypeORM's @Generated() decorator marks generated values.\nexport const column = 1;\n")).toBe(false);
    expect(hasGeneratedContent("src/client.ts", "// Returns true when this is a generated file.\nexport function isGenerated() {}\n")).toBe(false);
    expect(hasGeneratedContent("src/client.ts", "export function generate() {}\n")).toBe(false);
  });

  it("reads a source map reference as a compiler's own statement that the sources are elsewhere", () => {
    const bundle = "export const value = 1;\n//# sourceMappingURL=index.js.map\n";
    expect(hasGeneratedContent("static/index.js", bundle)).toBe(true);
    expect(hasGeneratedContent("static/app.css", "a{color:red}\n/*# sourceMappingURL=app.css.map */\n")).toBe(true);
    // The comment has to open the line, so a bundler's own source, which writes
    // the marker as a value, is left alone.
    expect(hasGeneratedContent("src/sourcemap.ts", 'const comment = "//# sourceMappingURL=" + name;\n')).toBe(false);
  });

  it("reads minified line shape, which is what is left of a bundle that carries no marker at all", () => {
    const minified = `${"!function(e,t){for(var n=0;n<e.length;n++)t(e[n]);}(a,b);".repeat(60)}\n`;
    expect(hasGeneratedContent("static/js/vendor.js", minified)).toBe(true);
    expect(hasGeneratedContent("static/css/bootstrap.css", `${".a{color:red}".repeat(300)}\n`)).toBe(true);
    // Hand-written CSS and JavaScript sit near 35 characters a line, so nothing
    // written by a person comes close.
    expect(hasGeneratedContent("src/web/styles.css", `${".panel {\n  color: red;\n}\n".repeat(200)}`)).toBe(false);
    // The shape is evidence for a bundler format only. A one-line JSON fixture
    // and a long prose paragraph are neither compiled nor minified.
    expect(hasGeneratedContent("tests/fixtures/events.json", `{"a":${'"x",'.repeat(1000)}"b":1}`)).toBe(false);
    expect(hasGeneratedContent("docs/design.md", `${"word ".repeat(600)}\n`)).toBe(false);
  });

  it("leaves a short file alone, because one long line is not a build", () => {
    expect(hasGeneratedContent("src/web/theme.css", ":root{--x:1}\n")).toBe(false);
  });
});

describe("scan admission", () => {
  it("accepts readable source extensions and refuses vendored or cached directories", () => {
    expect(isSourceFile("src/service.py")).toBe(true);
    expect(isSourceFile("site/index.htm")).toBe(true);
    expect(isSourceFile("site/index.xhtml")).toBe(true);
    expect(isSourceFile("assets/logo.png")).toBe(false);
    expect(isSourceFile("node_modules/left-pad/index.js")).toBe(false);
    expect(isSourceFile("app/__pycache__/service.py")).toBe(false);
  });

  it("accepts the whole shell family, not just .sh", () => {
    for (const name of ["deploy.sh", "build.bash", "run.ksh", "unit.bats", "prompt.zsh", "config.fish"]) {
      expect({ name, admitted: isSourceFile(`scripts/${name}`) }).toEqual({ name, admitted: true });
    }
  });

  it("admits known extensionless docs while refusing an unknown extensionless file", () => {
    expect(isSourceFile("README")).toBe(true);
    expect(isSourceFile("CITATION")).toBe(true);
    expect(isSourceFile("legal/LICENSE")).toBe(true);
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
    // Read across the whole path, because a catalogue is as often named by the
    // folder holding it as by its own filename.
    expect(refineKindByContent("code", "src/locales/de.ts", shape())).toBe("i18n");
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
    return refineKindByContent(classifyFile(name, findLocaleLevels([name])), name, { grammar, ...structure });
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
