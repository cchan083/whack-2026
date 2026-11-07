import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During development (npm run dev) the page runs on port 5173 and any request
// to /api is forwarded to the FastAPI server on port 8000.
export default defineConfig({
  plugins: [react()],
  // Path the site is served from: "/" normally, "/whack-2026/" on GitHub Pages.
  base: process.env.VITE_BASE || "/",
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8000" },
  },
  // Plotly alone is ~4.5 MB, so the default 500 kB size warning always fires.
  build: { chunkSizeWarningLimit: 6000 },
});
