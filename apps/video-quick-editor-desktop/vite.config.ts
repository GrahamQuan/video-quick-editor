import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import electron from "vite-plugin-electron/simple";

export default defineConfig({
  base: "./",
  plugins: [
    tailwindcss(),
    react({ compiler: { logDiagnostics: true } }),
    electron({
      main: {
        entry: resolve(import.meta.dirname, "src/main/index.ts"),
        vite: {
          build: {
            outDir: resolve(import.meta.dirname, "out/main"),
            emptyOutDir: true,
            rolldownOptions: {
              external: ["electron", "fontkit"],
              output: { format: "es", entryFileNames: "index.js" },
            },
          },
        },
      },
      preload: {
        input: resolve(import.meta.dirname, "src/preload/index.ts"),
        vite: {
          build: {
            outDir: resolve(import.meta.dirname, "out/preload"),
            emptyOutDir: true,
            rolldownOptions: {
              external: ["electron"],
              output: { format: "cjs", entryFileNames: "index.js" },
            },
          },
        },
      },
    }),
  ],
  build: {
    outDir: resolve(import.meta.dirname, "out/renderer"),
    emptyOutDir: true,
  },
});
