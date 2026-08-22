import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    // tsconfig の paths (@/* → src/*) と揃える
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
