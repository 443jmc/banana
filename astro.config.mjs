import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

const site = process.env.PUBLIC_SITE_URL || "https://jamesmchristensen.com";

export default defineConfig({
  site,
  output: "static",
  trailingSlash: "never",
  integrations: [
    sitemap({
      filter: (page) => !page.includes("/404"),
    }),
  ],
  redirects: {
    "/home": "/",
  },
  build: {
    format: "file",
  },
  prefetch: true,
});
