import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = process.env.API_URL ?? "http://localhost:4000";

export default defineConfig({
  plugins: [react()],
  server: { port: 5175, proxy: { "/admin": api, "/media": api } },
  preview: { port: 5175, proxy: { "/admin": api, "/media": api } },
});
