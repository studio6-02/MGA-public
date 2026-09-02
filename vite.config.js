import { execSync } from "node:child_process";
import { defineConfig } from "vite";

// Dataset JSONs live at fixed paths (no content hash), so the frontend appends
// this version to every fetch URL to bust stale browser caches after a deploy.
function datasetVersion() {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return Date.now().toString(36);
  }
}

export default defineConfig({
  base: "./",
  build: {
    target: "es2022"
  },
  define: {
    __MGA_DATASET_VERSION__: JSON.stringify(datasetVersion())
  }
});
