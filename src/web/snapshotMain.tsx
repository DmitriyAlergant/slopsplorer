import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { SnapshotBacklink, SnapshotContext } from "../shared/api.ts";
import { App } from "./App.tsx";
import { createSnapshotRuntime } from "./snapshotRuntime.ts";
import "./styles.css";

const container = document.querySelector("#root");
if (!container) throw new Error("Slopsplorer could not find its mount point");

const contextElement = document.querySelector("#slopsplorer-snapshot-context");
if (contextElement === null) throw new Error("Slopsplorer could not find its snapshot context");
const context = JSON.parse(contextElement.textContent ?? "") as unknown;
if (typeof context !== "object" || context === null || !("backlink" in context)) {
  throw new Error("Slopsplorer received an invalid snapshot context");
}
const backlink = context.backlink;
if (backlink !== null && !isSnapshotBacklink(backlink)) {
  throw new Error("Slopsplorer received an invalid snapshot backlink");
}

function isSnapshotBacklink(value: unknown): value is SnapshotBacklink {
  return typeof value === "object" && value !== null
    && "label" in value && typeof value.label === "string"
    && "url" in value && typeof value.url === "string";
}

const snapshotContext: SnapshotContext = { backlink };

createRoot(container).render(
  <StrictMode>
    <App runtime={createSnapshotRuntime()} backlink={snapshotContext.backlink} />
  </StrictMode>,
);
