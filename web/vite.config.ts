import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite configs run under Node, but the project does not depend on
// `@types/node`. Declare the slice of `process` we need to keep tsc happy
// without dragging in the full Node typings.
declare const process: { env: Record<string, string | undefined> };

// Set VITE_BASE=/portal/ when building for the embedded production mount.
// Defaults to "/" so `npm run dev` and bare `npm run build` keep working
// without ambient config.
const base = process.env.VITE_BASE || "/";

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8080",
      "/auth": "http://localhost:8080",
      "/healthz": "http://localhost:8080",
      "/ws": {
        target: "ws://localhost:8080",
        ws: true,
      },
    },
  },
});
