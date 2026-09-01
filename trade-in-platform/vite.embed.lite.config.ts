import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/**
 * LITE embed bundle for Framer / Shopify.
 *
 * Identical to vite.embed.config.ts except that the ~450 inlined product photos
 * are aliased away, taking tg-trade-in.js from ~10 MB to a couple hundred KB.
 * Photos are then loaded lazily from the backend's /devices route — the same
 * host that already answers /api/quote, so it is not an extra dependency.
 *
 * Use the full build only if you need the widget to render product photos with
 * no backend reachable at all.
 */
export default defineConfig({
  plugins: [react()],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  resolve: {
    alias: [
      {
        find: /^\.\/deviceImageBundles$/,
        replacement: resolve(__dirname, "src/data/deviceImageBundles.lite.ts"),
      },
    ],
  },
  build: {
    outDir: "dist-embed-lite",
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
