/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Backend port is configurable so a squatted port (e.g. 4100) can be worked
// around with TG_API_PORT=4110 npm run dev without editing this file.
const apiTarget = `http://localhost:${process.env.TG_API_PORT ?? 4100}`;

export default defineConfig({
  plugins: [react()],
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
