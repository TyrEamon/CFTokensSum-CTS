import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          vchart: ["@visactor/react-vchart", "@visactor/vchart"],
          icons: ["lucide-react"],
        },
      },
    },
  },
  server: {
    port: 5177,
    strictPort: false,
  },
  preview: {
    port: 4177,
    strictPort: false,
  },
});
