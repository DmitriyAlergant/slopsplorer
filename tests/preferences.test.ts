import { describe, expect, it } from "vitest";
import {
  readPreferences,
  readTreePanelRatio,
  writePreferences,
  writeTreePanelRatio,
  type PreferenceStorage,
} from "../src/web/preferences.ts";
import { readRequest } from "../src/web/urlState.ts";

class MemoryStorage implements PreferenceStorage {
  value: string | null = null;

  getItem(): string | null {
    return this.value;
  }

  setItem(_key: string, value: string): void {
    this.value = value;
  }
}

describe("view preferences", () => {
  it("persists only flavor selection, source-tree sorting, and the primary measure", () => {
    const storage = new MemoryStorage();
    const request = readRequest("?tree=weight&measure=codeLines&kinds=other%2Ccode&gen=1&path=src&q=worker");
    writePreferences(storage, request);

    expect(readPreferences(storage)).toEqual({
      kinds: ["code", "other"],
      showGenerated: true,
      treeSort: "weight",
      measure: "codeLines",
    });
  });

  it("ignores malformed stored data", () => {
    const storage = new MemoryStorage();
    storage.value = "{broken";
    expect(readPreferences(storage)).toBeNull();

    storage.value = JSON.stringify({ kinds: "code", showGenerated: true, treeSort: "weight", measure: "tokens" });
    expect(readPreferences(storage)).toBeNull();
  });

  it("discards a stored payload naming a measure this build does not know", () => {
    const storage = new MemoryStorage();
    storage.value = JSON.stringify({ kinds: ["code"], showGenerated: false, treeSort: "name", measure: "bytes" });
    expect(readPreferences(storage)).toBeNull();
  });

  it("persists a proportional source-tree width", () => {
    const storage = new MemoryStorage();
    writeTreePanelRatio(storage, 0.42);
    expect(readTreePanelRatio(storage, 0.27)).toBe(0.42);
  });

  it("rejects source-tree widths outside useful panel bounds", () => {
    const storage = new MemoryStorage();
    storage.value = "0.9";
    expect(readTreePanelRatio(storage, 0.27)).toBe(0.27);
  });
});
