import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // /api goes to the backend, so the page works from a phone opened at http://<this-pc-ip>:5173
  server: { port: 5173, strictPort: true, proxy: { "/api": "http://127.0.0.1:8000" } },
});
