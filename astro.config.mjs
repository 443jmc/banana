import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

const site = process.env.PUBLIC_SITE_URL || "https://jamesmchristensen.com";

export default defineConfig({
  site,
  output: "static",
  trailingSlash: "never",
  integrations: [
    sitemap({
      filter: (page) => {
        const path = new URL(page).pathname.replace(/\.html$/, "").replace(/\/+$/, "") || "/";
        return path !== "/404" && path !== "/home";
      },
      serialize(item) {
        const url = new URL(item.url);
        const path = url.pathname.replace(/\.html$/, "").replace(/\/+$/, "") || "";
        item.url = path ? `${url.origin}${path}` : url.origin;
        return item;
      },
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
