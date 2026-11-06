import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/supabase/vite";

// Security headers also shipped statically via `public/_headers`
// for hosts that honor the Netlify-style headers file (Netlify, Vercel,
// Cloudflare Pages, Supabase Storage). Kept in sync here so dev matches prod.
const securityHeaders: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=(), payment=()",
};

// The production database is the Supabase project AN Maintenance, not Lovable Cloud.
//
// Lovable Cloud rewrites `.env` with its own project whenever the Lovable agent runs.
// It did exactly that on 05/11/2026 at 19:36 (commit d849f3e), a few minutes after the
// app had been pointed at AN Maintenance, and the next publish quietly sent the whole
// factory back to the old database. So the address and key cannot come from `.env`:
// they are fixed here, where nothing rewrites them, and replace every
// `import.meta.env.VITE_SUPABASE_*` in the bundle. Both values are public (the anon key
// ships in every page anyway).
const PRODUCTION_SUPABASE = {
  projectId: "apblxaaktftinstoidvp",
  url: "https://apblxaaktftinstoidvp.supabase.co",
  anonKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwYmx4YWFrdGZ0aW5zdG9pZHZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc5OTE5MDgsImV4cCI6MjA4MzU2NzkwOH0.wgG5JA6Tl81SsOfq9-n1uOY7lqDL6gmG4wjHjjupxxM",
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(PRODUCTION_SUPABASE.url),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(PRODUCTION_SUPABASE.anonKey),
    "import.meta.env.VITE_SUPABASE_PROJECT_ID": JSON.stringify(PRODUCTION_SUPABASE.projectId),
  },
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    // Vite dev server needs eval + inline styles for HMR — full CSP only in prod.
    headers: securityHeaders,
  },
  preview: {
    headers: securityHeaders,
  },
  plugins: [react(), mode === "development" && componentTagger(), mcpPlugin()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
