import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import pages from "vite-plugin-pages";

const backend = process.env.TORRENTED_BACKEND ?? "http://localhost:8080";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    pages({
      dirs: "src/pages",
      extensions: ["tsx"],
      exclude: ["**/components/**"],
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: backend, changeOrigin: false },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
  },
});
