import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://app.betal.fo",
  output: "server",
  adapter: cloudflare({
    platformProxy: { enabled: true },
  }),
  vite: {
    plugins: [tailwindcss()],
    server: {
      // Vite rejects requests whose Host header it does not recognise. Allowing the
      // Cloudflare quick-tunnel domain lets `astro dev --host` be reached through a
      // tunnel, which is how this gets demoed from a remote machine. Dev only — the
      // deployed Worker never reads this.
      allowedHosts: [".trycloudflare.com"],
    },
  },
});
