import { describe, expect, it } from "vitest";
import { aspectFigure, comparisonLabel, shortRevision } from "../src/web/format.ts";

const FULL_SHA = "87d1e8b76cece130474a7fcc6093528f3c20cd4c";

describe("shortRevision", () => {
  it("abbreviates a whole object name", () => {
    expect(shortRevision(FULL_SHA)).toBe("87d1e8b76c");
    expect(shortRevision(FULL_SHA.toUpperCase())).toBe("87D1E8B76C");
  });

  it("abbreviates a sha-256 object name", () => {
    expect(shortRevision("a".repeat(64))).toBe("aaaaaaaaaa");
  });

  // Anything shorter is already what someone typed, and cutting it further
  // could turn an unambiguous prefix into an ambiguous one.
  it("leaves a name that is not a whole object name alone", () => {
    expect(shortRevision("87d1e8b")).toBe("87d1e8b");
    expect(shortRevision("origin/main")).toBe("origin/main");
    expect(shortRevision("HEAD")).toBe("HEAD");
    expect(shortRevision(`${FULL_SHA}^`)).toBe(`${FULL_SHA}^`);
    expect(shortRevision("decade")).toBe("decade");
  });
});

describe("comparisonLabel", () => {
  it("names every comparison, with long revisions abbreviated", () => {
    expect(comparisonLabel({ kind: "workingTree" })).toBe("HEAD -> working tree");
    expect(comparisonLabel({ kind: "staged" })).toBe("HEAD -> index");
    expect(comparisonLabel({ kind: "revisionToWorkingTree", rev: FULL_SHA }))
      .toBe("87d1e8b76c -> working tree");
    expect(comparisonLabel({ kind: "revisionPair", base: "origin/main", target: FULL_SHA }))
      .toBe("origin/main -> 87d1e8b76c");
    expect(comparisonLabel({ kind: "mergeBase", base: "origin/main", target: "dev" }))
      .toBe("origin/main -> dev, from the merge base");
  });
});

describe("aspectFigure", () => {
  // A side keeps the direction of the side it names, whatever its own value is,
  // so the same figure reads the same in a strip, a tile, and a scope readout.
  it("signs each side by what it names", () => {
    expect(aspectFigure("added", 1200)).toEqual({ text: "+1,200", sign: "positive" });
    expect(aspectFigure("removed", 1200)).toEqual({ text: "-1,200", sign: "negative" });
  });

  it("signs net by its own direction", () => {
    expect(aspectFigure("net", 1200)).toEqual({ text: "+1,200", sign: "positive" });
    expect(aspectFigure("net", -1200)).toEqual({ text: "-1,200", sign: "negative" });
  });

  // Nothing has no direction, and a red "-0" reads as a broken figure.
  it("leaves nothing unsigned", () => {
    expect(aspectFigure("added", 0)).toEqual({ text: "0", sign: "zero" });
    expect(aspectFigure("removed", 0)).toEqual({ text: "0", sign: "zero" });
    expect(aspectFigure("net", 0)).toEqual({ text: "0", sign: "zero" });
  });

  it("leaves churn and the after-image as plain counts", () => {
    expect(aspectFigure("churn", 2400)).toEqual({ text: "2,400", sign: "none" });
    expect(aspectFigure("after", 2400)).toEqual({ text: "2,400", sign: "none" });
  });
});
