import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(here, "src/web"),
  plugins: [react()],
  experimental: {
    renderBuiltUrl(_filename, { hostId, hostType }) {
      if (hostType === "html" && path.basename(hostId) !== "snapshot.html") return undefined;
      if (hostType === "html") return `./${_filename}`;
      return { relative: true };
    },
  },
  build: {
    outDir: path.join(here, "dist/web"),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        index: path.join(here, "src/web/index.html"),
        snapshot: path.join(here, "src/web/snapshot.html"),
      },
    },
  },
});
