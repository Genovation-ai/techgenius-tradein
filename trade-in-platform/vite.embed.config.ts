import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/** IIFE bundle for Shopify theme Assets / CDN */
export default defineConfig({
  plugins: [react()],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "dist-embed",
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: resolve(__dirname, "src/shopifyEmbed.tsx"),
      name: "TechGeniusTradeIn",
      formats: ["iife"],
      fileName: () => "tg-trade-in.js",
    },
    rollupOptions: {
      output: {
        assetFileNames: "tg-trade-in.[ext]",
        inlineDynamicImports: true,
      },
    },
  },
});
