/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Backend port is configurable so a squatted port (e.g. 4100) can be worked
// around with TG_API_PORT=4110 npm run dev without editing this file.
const apiTarget = `http://localhost:${process.env.TG_API_PORT ?? 4100}`;

export default defineConfig({
  plugins: [react()],
  /**
   * Keep the ~450 inlined product photos out of the app bundle.
   *
   * deviceImageBundles.ts is 9.5 MB of base64 PNGs, which put index.js at
   * 10 MB. A phone spent its whole load budget parsing photos it mostly never
   * scrolled to, and most of them failed to decode — testers saw a device list
   * with no pictures. The backend serves the identical files from /devices/,
   * lazily and cached, and it has to be reachable anyway because quotes are
   * server-authoritative. Same alias the lite embed build already used.
   */
  resolve: {
    alias: [
      {
        find: /^\.\/deviceImageBundles$/,
        replacement: resolve(__dirname, "src/data/deviceImageBundles.lite.ts"),
      },
    ],
  },
  server: {
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
      "/devices": {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
  },
});
