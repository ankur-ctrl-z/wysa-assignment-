import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In dev the API is a separate process; in Docker nginx does the same job.
    proxy: { "/api": "http://localhost:3000" },
  },
});
