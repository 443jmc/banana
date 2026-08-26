import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const seo = {
  title: z.string(),
  description: z.string().optional().default(""),
  pubDate: z.coerce.date().optional(),
  heroImage: z.string().optional(),
  excerpt: z.string().optional(),
  sourceUrl: z.string().optional(),
  audioUrl: z.string().optional(),
  embeds: z.array(z.string()).optional(),
};

const pages = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/pages" }),
  schema: z.object(seo),
});

const blog = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/blog" }),
  schema: z.object(seo),
});

const podcast = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/podcast" }),
  schema: z.object(seo),
});

const bookSummaries = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/book-summaries" }),
  schema: z.object(seo),
});

export const collections = {
  pages,
  blog,
  podcast,
  "book-summaries": bookSummaries,
};
