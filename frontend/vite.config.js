import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // During local development, forward API calls to the backend server.
    // Run the backend separately: cd ../backend && uvicorn server:app --reload --port 8000
    proxy: {
      "/chat": "http://localhost:8000",
    },
  },
});
