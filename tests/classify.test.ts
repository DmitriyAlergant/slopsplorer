import { describe, expect, it } from "vitest";
import { classifyFile, isGenerated, isSourceFile } from "../src/scanner/classify.ts";

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
});
