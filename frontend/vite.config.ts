import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

// HTTPS=1 npm run dev — self-signed HTTPS, needed for the microphone on a phone (browsers allow it only
// on https or localhost). The phone shows a certificate warning once; accept it.
declare const process: { env: Record<string, string | undefined> };  // no @types/node in this project
const https = process.env.HTTPS === "1";

export default defineConfig({
  plugins: [react(), ...(https ? [basicSsl()] : [])],
  // /api goes to the backend, so the page works from a phone opened at http(s)://<this-pc-ip>:5173
  server: { port: 5173, strictPort: true, proxy: { "/api": "http://127.0.0.1:8000" } },
});
