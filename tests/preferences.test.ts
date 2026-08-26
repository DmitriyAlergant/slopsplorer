import { describe, expect, it } from "vitest";
import { readPreferences, writePreferences, type PreferenceStorage } from "../src/web/preferences.ts";
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
  it("persists only flavor selection and source-tree sorting", () => {
    const storage = new MemoryStorage();
    const request = readRequest("?tree=tokens&kinds=other%2Ccode&gen=1&path=src&q=worker");
    writePreferences(storage, request);

    expect(readPreferences(storage)).toEqual({
      kinds: ["code", "other"],
      showGenerated: true,
      treeSort: "tokens",
    });
  });

  it("ignores malformed stored data", () => {
    const storage = new MemoryStorage();
    storage.value = "{broken";
    expect(readPreferences(storage)).toBeNull();

    storage.value = JSON.stringify({ kinds: "code", showGenerated: true, treeSort: "tokens" });
    expect(readPreferences(storage)).toBeNull();
  });
});
