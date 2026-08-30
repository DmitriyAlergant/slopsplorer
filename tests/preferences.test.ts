import { describe, expect, it } from "vitest";
import {
  readChangedLinesOnly,
  readOpenInApplication,
  readPreferences,
  readTreePanelRatio,
  readWorkspaceHeight,
  readWrapLines,
  writeChangedLinesOnly,
  writeOpenInApplication,
  writePreferences,
  writeTreePanelRatio,
  writeWorkspaceHeight,
  writeWrapLines,
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
  it("persists sorting and the primary measure and aspect, but not flavor selection", () => {
    const storage = new MemoryStorage();
    const request = readRequest("?tree=weight&measure=codeLines&aspect=net&rank=functions&kinds=other%2Ccode&gen=1&path=src&q=worker");
    writePreferences(storage, request);

    expect(readPreferences(storage)).toEqual({
      treeSort: "weight",
      measure: "codeLines",
      aspect: "net",
      rankMetric: "functions",
    });
  });

  it("discards a payload from before the aspect existed, rather than half-reading it", () => {
    const storage = new MemoryStorage();
    storage.value = JSON.stringify({
      treeSort: "name", measure: "tokens", rankMetric: "tokens",
    });
    expect(readPreferences(storage)).toBeNull();
  });

  it("ignores malformed stored data", () => {
    const storage = new MemoryStorage();
    storage.value = "{broken";
    expect(readPreferences(storage)).toBeNull();

    storage.value = JSON.stringify({
      treeSort: "weight", measure: "tokens", rankMetric: "tokens",
    });
    expect(readPreferences(storage)).toBeNull();
  });

  it("discards a stored payload naming a measure this build does not know", () => {
    const storage = new MemoryStorage();
    storage.value = JSON.stringify({
      treeSort: "name", measure: "bytes", aspect: "churn", rankMetric: "tokens",
    });
    expect(readPreferences(storage)).toBeNull();
  });

  it("discards a stored payload naming a sorted column this build does not know", () => {
    const storage = new MemoryStorage();
    storage.value = JSON.stringify({
      treeSort: "name", measure: "tokens", aspect: "churn", rankMetric: "classes",
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

  it("persists a preview that hides the unchanged lines, and shows them until it is asked to", () => {
    const storage = new MemoryStorage();
    expect(readChangedLinesOnly(storage)).toBe(false);
    writeChangedLinesOnly(storage, true);
    expect(readChangedLinesOnly(storage)).toBe(true);
    writeChangedLinesOnly(storage, false);
    expect(readChangedLinesOnly(storage)).toBe(false);
  });

  it("persists a preview that wraps long lines, and scrolls them sideways until it is asked to", () => {
    const storage = new MemoryStorage();
    expect(readWrapLines(storage)).toBe(false);
    writeWrapLines(storage, true);
    expect(readWrapLines(storage)).toBe(true);
    writeWrapLines(storage, false);
    expect(readWrapLines(storage)).toBe(false);
  });

  it("persists the application used to open a folder and defaults an unknown value to Cursor", () => {
    const storage = new MemoryStorage();
    expect(readOpenInApplication(storage)).toBe("cursor");
    writeOpenInApplication(storage, "vscode");
    expect(readOpenInApplication(storage)).toBe("vscode");
    storage.value = "unknown";
    expect(readOpenInApplication(storage)).toBe("cursor");
  });
});
