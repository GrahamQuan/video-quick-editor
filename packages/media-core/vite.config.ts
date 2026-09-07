import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    lib: {
      entry: resolve(import.meta.dirname, "src/index.ts"),
      formats: ["es"],
      fileName: "index",
    },
    rolldownOptions: {
      external: [
        "@video-quick-editor/shared",
        "zod",
        ...builtinModules,
        ...builtinModules.map((name) => `node:${name}`),
      ],
      output: { entryFileNames: "index.js" },
    },
  },
});
