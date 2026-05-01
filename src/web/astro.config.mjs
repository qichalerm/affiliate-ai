import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import tailwind from "@astrojs/tailwind";

const SITE = process.env.SITE_URL ?? `https://${process.env.DOMAIN_NAME ?? "yourdomain.com"}`;

export default defineConfig({
  site: SITE,
  trailingSlash: "never",
  output: "static",
  build: {
    format: "directory",
    inlineStylesheets: "auto",
  },
  integrations: [
    tailwind({ applyBaseStyles: false }),
    sitemap({
      changefreq: "daily",
      priority: 0.7,
      lastmod: new Date(),
    }),
  ],
  compressHTML: true,
  prefetch: {
    defaultStrategy: "viewport",
  },
  experimental: {
    contentIntellisense: true,
  },
});
