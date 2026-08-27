import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://betal.fo",
  trailingSlash: "always",
  vite: {
    plugins: [tailwindcss()],
  },
});
