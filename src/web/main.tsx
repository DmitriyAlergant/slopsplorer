import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";

const container = document.querySelector("#root");
if (!container) throw new Error("Slopsplorer could not find its mount point");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
