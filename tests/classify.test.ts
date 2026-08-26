import { describe, expect, it } from "vitest";
import { classifyFile, isGenerated, isSourceFile, shebangInterpreter } from "../src/scanner/classify.ts";

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

  it("attributes a JSON fixture under tests/ to the test surface rather than to project data", () => {
    // Test detection runs before the data-extension check on purpose: a fixture
    // is weight belonging to the test suite, and hiding tests should hide it.
    expect(classifyFile("tests/fixtures/events.json")).toBe("test");
    expect(classifyFile("__tests__/fixtures/users.yaml")).toBe("test");
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
