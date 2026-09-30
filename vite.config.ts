import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    // Vite's dev server rejects requests whose Host header is not allow-listed.
    // The managed preview is served from a *.e2b.app subdomain, so allow that
    // domain (and its subdomains) without loosening anything else. This does
    // not touch host binding, the port, or HMR.
    allowedHosts: [".e2b.app"],
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
