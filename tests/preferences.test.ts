import { describe, expect, it } from "vitest";
import {
  readChangedLinesOnly,
  readPreferences,
  readRankingHeight,
  readTreePanelRatio,
  readWorkspaceHeight,
  writeChangedLinesOnly,
  writePreferences,
  writeRankingHeight,
  writeTreePanelRatio,
  writeWorkspaceHeight,
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
  it("persists only flavor selection, sorting, and the primary measure and aspect", () => {
    const storage = new MemoryStorage();
    const request = readRequest("?tree=weight&measure=codeLines&aspect=net&rank=functions&kinds=other%2Ccode&gen=1&path=src&q=worker");
    writePreferences(storage, request);

    expect(readPreferences(storage)).toEqual({
      kinds: ["code", "other"],
      showGenerated: true,
      treeSort: "weight",
      measure: "codeLines",
      aspect: "net",
      rankMetric: "functions",
    });
  });

  it("discards a payload from before the aspect existed, rather than half-reading it", () => {
    const storage = new MemoryStorage();
    storage.value = JSON.stringify({
      kinds: ["code"], showGenerated: false, treeSort: "name", measure: "tokens", rankMetric: "tokens",
    });
    expect(readPreferences(storage)).toBeNull();
  });

  it("ignores malformed stored data", () => {
    const storage = new MemoryStorage();
    storage.value = "{broken";
    expect(readPreferences(storage)).toBeNull();

    storage.value = JSON.stringify({
      kinds: "code", showGenerated: true, treeSort: "weight", measure: "tokens", aspect: "churn", rankMetric: "tokens",
    });
    expect(readPreferences(storage)).toBeNull();
  });

  it("discards a stored payload naming a measure this build does not know", () => {
    const storage = new MemoryStorage();
    storage.value = JSON.stringify({
      kinds: ["code"], showGenerated: false, treeSort: "name", measure: "bytes", aspect: "churn", rankMetric: "tokens",
    });
    expect(readPreferences(storage)).toBeNull();
  });

  it("discards a stored payload naming a sorted column this build does not know", () => {
    const storage = new MemoryStorage();
    storage.value = JSON.stringify({
      kinds: ["code"], showGenerated: false, treeSort: "name", measure: "tokens", rankMetric: "classes",
    });
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

  it("persists a dragged workspace height", () => {
    const storage = new MemoryStorage();
    writeWorkspaceHeight(storage, 420);
    expect(readWorkspaceHeight(storage, 660)).toBe(420);
  });

  it("rejects workspace heights outside useful panel bounds", () => {
    const storage = new MemoryStorage();
    storage.value = "40";
    expect(readWorkspaceHeight(storage, 660)).toBe(660);
    storage.value = "9000";
    expect(readWorkspaceHeight(storage, 660)).toBe(660);
  });

  it("persists a dragged ranking height", () => {
    const storage = new MemoryStorage();
    writeRankingHeight(storage, 260);
    expect(readRankingHeight(storage, 480)).toBe(260);
  });

  it("rejects ranking heights outside useful list bounds", () => {
    const storage = new MemoryStorage();
    storage.value = "20";
    expect(readRankingHeight(storage, 480)).toBe(480);
    storage.value = "9000";
    expect(readRankingHeight(storage, 480)).toBe(480);
  });

  it("persists a preview that hides the unchanged lines, and shows them until it is asked to", () => {
    const storage = new MemoryStorage();
    expect(readChangedLinesOnly(storage)).toBe(false);
    writeChangedLinesOnly(storage, true);
    expect(readChangedLinesOnly(storage)).toBe(true);
    writeChangedLinesOnly(storage, false);
    expect(readChangedLinesOnly(storage)).toBe(false);
  });
});
