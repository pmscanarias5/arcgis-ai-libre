import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Ajusta "base" si despliegas en IIS bajo una subruta (como en tu proyecto anterior)
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    port: 5173
  }
});
