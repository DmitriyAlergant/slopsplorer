import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(here, "src/web"),
  plugins: [react()],
  build: {
    outDir: path.join(here, "dist/web"),
    emptyOutDir: true,
    sourcemap: false,
  },
});
