import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base:"/",
  publicDir:false,
  define:{"import.meta.env.VITE_NASQO_HYBRID":JSON.stringify("0")},
  build:{outDir:"dist/original-web-client",emptyOutDir:true},
  plugins:[{
    name:"original-web-offline-packaging",
    transformIndexHtml:{
      order:"pre",
      handler(html){
        return html.replace(/<link\b[^>]*\b(?:href|src)=["']https?:\/\/[^"']+["'][^>]*>/gi,"")
          .replace('src="/src/main.tsx"','src="/mobile_runtime/web-entry.ts"');
      }
    }
  },react()]
});
