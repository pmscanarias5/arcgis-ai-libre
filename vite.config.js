import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  plugins: [
    react(),
    // LangGraph/LangChain asumen en parte un entorno Node; este plugin evita
    // errores de bundling por módulos como "async_hooks", "process", etc.
    // al ejecutarse en el navegador. Si tras `npm install` el build falla
    // señalando un módulo Node concreto, es la primera pista a revisar aquí.
    nodePolyfills()
  ],
  base: "./",
  server: {
    port: 5173
  }
});