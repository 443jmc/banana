#!/usr/bin/env node
/**
 * Import content from the live Squarespace site into Astro collections.
 *
 * Usage: npm run scrape
 *
 * 1. Fetches https://jamesmchristensen.com/sitemap.xml
 * 2. Fetches each page
 * 3. Extracts main content (not Squarespace chrome)
 * 4. Downloads images into public/images/
 * 5. Writes Markdown into src/content/{pages,blog,podcast,book-summaries}
 * 6. If public/audio/<slug> already exists, podcast pages use that URL
 *    instead of Squarespace (run `npm run fetch-audio` after a scrape)
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createWriteStream, existsSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import TurndownService from "turndown";

const ROOT = new URL("..", import.meta.url).pathname;
const SITE = "https://jamesmchristensen.com";
const SITEMAP = `${SITE}/sitemap.xml`;
const UA =
  "Mozilla/5.0 (compatible; RosevilleSiteImporter/1.0; +https://github.com/443jmc/banana)";

const SKIP_PATHS = new Set([
  "/cart",
  "/404",
  "/home",
]);

const INDEX_PATHS = new Set(["/blog", "/podcast", "/book-summaries"]);

const CONCURRENCY = 5;
const RETRIES = 3;
const IMAGE_FORMAT = "1000w";

const report = {
  fetched: 0,
  written: 0,
  skipped: [],
  failed: [],
  images: 0,
  notes: [],
};

const imageCache = new Map(); // remote url -> local path

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function slugifyName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "image";
}

function firstPartyAudio(slug) {
  if (!slug) return null;
  for (const ext of ["mp3", "mp4", "m4a"]) {
    if (existsSync(join(ROOT, "public/audio", `${slug}.${ext}`))) {
      return `/audio/${slug}.${ext}`;
    }
  }
  return null;
}

function classify(pathname) {
  if (pathname.startsWith("/blog/") && pathname !== "/blog/") return "blog";
  if (pathname.startsWith("/podcast/") && pathname !== "/podcast/") return "podcast";
  if (pathname.startsWith("/book-summaries/") && pathname !== "/book-summaries/") {
    return "book-summaries";
  }
  if (INDEX_PATHS.has(pathname) || pathname === "/") return "meta";
  return "pages";
}

function yamlEscape(value) {
  if (value == null) return '""';
  const s = String(value);
  if (s === "") return '""';
  if (/[:#\n"'{}[\],&*?|<>=!%@`]/.test(s) || s !== s.trim()) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
  }
  return s;
}

async function fetchText(url) {
  let lastErr;
  for (let i = 0; i < RETRIES; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "text/html,application/xml;q=0.9,*/*;q=0.8" },
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      await sleep(400 * (i + 1));
    }
  }
  throw lastErr;
}

function optimizeImageUrl(url) {
  if (!url) return url;
  try {
    const u = new URL(url, SITE);
    if (u.hostname.includes("squarespace-cdn.com") || u.hostname.includes("squarespace.com")) {
      if (!u.searchParams.has("format")) u.searchParams.set("format", IMAGE_FORMAT);
      return u.toString();
    }
    return u.toString();
  } catch {
    return url;
  }
}

async function downloadImage(remoteUrl, destDir, hint) {
  if (!remoteUrl) return null;
  let absolute;
  try {
    absolute = new URL(remoteUrl, SITE).toString();
  } catch {
    return null;
  }
  if (absolute.startsWith("data:")) return null;
  if (imageCache.has(absolute)) return imageCache.get(absolute);

  const optimized = optimizeImageUrl(absolute);
  const cacheKey = optimized;
  if (imageCache.has(cacheKey)) return imageCache.get(cacheKey);

  let lastErr;
  for (let i = 0; i < RETRIES; i++) {
    try {
      const res = await fetch(optimized, { headers: { "User-Agent": UA }, redirect: "follow" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("text/html")) throw new Error("got html instead of image");
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 80) throw new Error("image too small");
      const hash = createHash("sha1").update(buf).digest("hex").slice(0, 10);
      let ext = extname(new URL(absolute).pathname).toLowerCase();
      if (!ext || ext.length > 5) {
        if (ct.includes("png")) ext = ".png";
        else if (ct.includes("webp")) ext = ".webp";
        else if (ct.includes("gif")) ext = ".gif";
        else if (ct.includes("svg")) ext = ".svg";
        else if (ct.includes("ico")) ext = ".ico";
        else ext = ".jpg";
      }
      const base = slugifyName(hint || decodeURIComponent(new URL(absolute).pathname.split("/").pop() || "image"));
      const filename = `${base}-${hash}${ext}`;
      const rel = `/images/${destDir}/${filename}`;
      const abs = join(ROOT, "public", rel);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, buf);
      imageCache.set(absolute, rel);
      imageCache.set(cacheKey, rel);
      report.images += 1;
      return rel;
    } catch (err) {
      lastErr = err;
      await sleep(250 * (i + 1));
    }
  }
  report.notes.push(`image failed: ${remoteUrl} (${lastErr?.message || lastErr})`);
  return null;
}

function decodeHtml(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function isFooterish(text) {
  const t = text.replace(/\s+/g, " ").trim();
  // Only skip the short repeating address block, not articles that mention the office.
  if (t.length > 280) return false;
  return (
    t.includes("300 Harding Blvd") &&
    (t.includes("LMFT #142990") || t.includes("916-292-8920"))
  );
}

function collectJsonLd($) {
  const items = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text().trim();
    if (!raw) return;
    try {
      items.push(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  });
  return items;
}

function pickDate(ldItems, $) {
  for (const item of ldItems) {
    if (item.datePublished) return item.datePublished;
    if (item.dateCreated) return item.dateCreated;
  }
  const t = $("time[datetime]").first().attr("datetime");
  return t || null;
}

function extractAudio($) {
  const urls = [];
  $("[data-asset-url]").each((_, el) => {
    const u = $(el).attr("data-asset-url");
    if (u && /\.(mp3|m4a|wav|aac|ogg)(\?|$)/i.test(u)) urls.push(u);
  });
  $("audio[src], source[src]").each((_, el) => {
    const u = $(el).attr("src");
    if (u) urls.push(u);
  });
  return [...new Set(urls)];
}

function extractEmbeds($) {
  const embeds = [];
  $("[data-html]").each((_, el) => {
    const raw = decodeHtml($(el).attr("data-html") || "");
    const src = raw.match(/src=["']([^"']+)["']/);
    if (src) embeds.push(src[1]);
  });
  $("iframe[src]").each((_, el) => {
    const src = $(el).attr("src");
    if (src && !src.includes("googletagmanager")) embeds.push(src);
  });
  return [...new Set(embeds)];
}

function extractMainHtml($) {
  const $page = $("#page, main, .blog-item").first();
  const root = $page.length ? $page : $.root();
  const chunks = [];

  const $contentRoot = root.find(".blog-item-content").first().length
    ? root.find(".blog-item-content").first()
    : root;

  $contentRoot
    .find(".sqs-html-content, .sqs-audio-embed, .sqs-video-wrapper, .image-block, img[data-src], img[src]")
    .each((_, el) => {
      const $el = $(el);
      if ($el.closest("header, .header, footer, .footer").length) return;
      if ($el.parents(".sqs-html-content").length && $el.is("img")) return;

      if ($el.hasClass("sqs-html-content")) {
        const text = $el.text().trim();
        if (!text) return;
        if (isFooterish(text)) return;
        chunks.push($el.html() || "");
        return;
      }

      if ($el.hasClass("sqs-audio-embed")) {
        const url = $el.attr("data-asset-url");
        const title = $el.attr("data-title") || "Audio";
        if (url) {
          chunks.push(
            `<p><audio controls preload="none" src="${url}"></audio><br/><a href="${url}">Download ${title}</a></p>`
          );
        }
        return;
      }

      if ($el.hasClass("sqs-video-wrapper")) {
        const raw = decodeHtml($el.attr("data-html") || "");
        const src = raw.match(/src=["']([^"']+)["']/);
        const title = raw.match(/title=["']([^"']+)["']/);
        if (src) {
          chunks.push(
            `<div class="embed-frame"><iframe src="${src[1]}" title="${title?.[1] || "Video"}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe></div>`
          );
        }
        return;
      }

      if ($el.is("img")) {
        const src = $el.attr("data-src") || $el.attr("src");
        if (!src || src.startsWith("data:")) return;
        if (src.includes("favicon")) return;
        const alt = $el.attr("alt") || "";
        chunks.push(`<p><img src="${src}" alt="${alt}"></p>`);
      }
    });

  // Fallback: dump remaining html-content if nothing found
  if (!chunks.length) {
    $(".sqs-html-content").each((_, el) => {
      const text = $(el).text().trim();
      if (text && !isFooterish(text)) chunks.push($(el).html() || "");
    });
  }

  return chunks.join("\n\n");
}

function makeTurndown() {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    bulletList: "-",
  });
  td.keep(["iframe", "audio", "div"]);
  td.addRule("embedFrame", {
    filter: (node) => node.classList && node.classList.contains("embed-frame"),
    replacement: (_c, node) => `\n\n${node.outerHTML}\n\n`,
  });
  td.addRule("iframe", {
    filter: "iframe",
    replacement: (_c, node) => `\n\n${node.outerHTML}\n\n`,
  });
  td.addRule("audio", {
    filter: "audio",
    replacement: (_c, node) => `\n\n${node.outerHTML}\n\n`,
  });
  return td;
}

function excerptFrom(markdown, title) {
  const text = markdown
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/[#>*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const withoutTitle = text.startsWith(title) ? text.slice(title.length).trim() : text;
  if (withoutTitle.length <= 220) return withoutTitle;
  return withoutTitle.slice(0, 217).replace(/\s+\S*$/, "") + "…";
}

async function rewriteImages(html, destDir, slug) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const imgs = $("img")
    .toArray()
    .map((el) => {
      const $el = $(el);
      return { el: $el, src: $el.attr("src") || $el.attr("data-src") };
    })
    .filter((x) => x.src);

  for (const { el, src } of imgs) {
    const local = await downloadImage(src, destDir, slug);
    if (local) {
      el.attr("src", local);
      el.removeAttr("data-src");
      el.removeAttr("srcset");
    }
  }
  return $.root().find("body").length ? $("body").html() : $.html();
}

function parseSitemap(xml) {
  const locs = [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)].map((m) => m[1].trim());
  const lastmods = new Map();
  const blocks = xml.split(/<url>/).slice(1);
  for (const block of blocks) {
    const loc = block.match(/<loc>\s*([^<]+)\s*<\/loc>/)?.[1]?.trim();
    const lastmod = block.match(/<lastmod>\s*([^<]+)\s*<\/lastmod>/)?.[1]?.trim();
    const image = block.match(/<image:loc>\s*([^<]+)\s*<\/image:loc>/)?.[1]?.trim();
    if (loc) lastmods.set(loc, { lastmod, image });
  }
  return { locs, lastmods };
}

async function scrapePage(url, sitemapMeta) {
  const pathname = new URL(url).pathname.replace(/\/$/, "") || "/";
  if (SKIP_PATHS.has(pathname)) {
    report.skipped.push({ url, reason: "intentionally skipped" });
    return;
  }

  const kind = classify(pathname);
  const html = await fetchText(url);
  report.fetched += 1;
  const $ = cheerio.load(html);

  const ld = collectJsonLd($);
  const liveTitle = decodeHtml($("title").first().text().replace(/\s+/g, " ").trim());
  const docTitle = liveTitle.split("|")[0].trim();
  const rawTitle =
    $("h1")
      .slice(0, 3)
      .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
      .get()
      .filter(Boolean)
      .join(" ") ||
    $("meta[property='og:title']").attr("content") ||
    docTitle;
  let title = decodeHtml((rawTitle || "").split("|")[0].trim()).replace(/&nbsp;/g, " ");
  if (title.length < 16 || / in$/i.test(title) || / and$/i.test(title)) {
    title = docTitle || title;
  }
  let description = decodeHtml(
    $("meta[name='description']").attr("content")?.trim() ||
      $("meta[property='og:description']").attr("content")?.trim() ||
      ""
  ).replace(/&nbsp;/g, " ");
  const ogImage = $("meta[property='og:image']").attr("content") || sitemapMeta?.image || "";
  const date = pickDate(ld, $) || sitemapMeta?.lastmod || null;
  const audioUrls = extractAudio($);
  const embeds = extractEmbeds($);

  let mainHtml = extractMainHtml($);
  const slug =
    pathname === "/"
      ? "index"
      : pathname.replace(/^\//, "").replace(/\/+/g, "--");

  const destDir = kind === "meta" ? "site" : kind;
  mainHtml = await rewriteImages(mainHtml, destDir, slug.replace(/--/g, "-"));

  const td = makeTurndown();
  let markdown = td.turndown(mainHtml || "").trim();
  markdown = markdown.replace(/\n{3,}/g, "\n\n");
  markdown = markdown.replace(/https?:\/\/(?:www\.)?jamesmchristensen\.com/g, "");
  markdown = markdown.replace(
    /https?:\/\/james\.clientsecure\.me\/?(?:request\/service)?/g,
    "https://james.clientsecure.me/request/service"
  );

  // Unique hero: skip the shared screenshot OG used on most static pages
  const ogIsDefault =
    /Screenshot\+2026-01-26/i.test(ogImage) || /3\.44\.35/i.test(ogImage);
  let heroImage = null;
  if (ogImage && !ogIsDefault) {
    heroImage = await downloadImage(ogImage, destDir, slug.replace(/--/g, "-"));
  }
  if (!heroImage && sitemapMeta?.image) {
    heroImage = await downloadImage(sitemapMeta.image, destDir, slug.replace(/--/g, "-"));
  }
  if (!heroImage) {
    const firstMdImg = markdown.match(/!\[.*?\]\((\/images\/[^)]+)\)/);
    if (firstMdImg) heroImage = firstMdImg[1];
  }

  const fm = {
    title: title || slug,
    description,
    sourceUrl: url,
  };
  if (liveTitle) fm.seoTitle = liveTitle;
  if (date) fm.pubDate = date;
  if (heroImage) fm.heroImage = heroImage;
  if (kind === "blog" || kind === "podcast" || kind === "book-summaries") {
    fm.excerpt = excerptFrom(markdown, title);
  }
  if (audioUrls[0]) fm.audioUrl = audioUrls[0];
  if (embeds.length) fm.embeds = embeds;

  const pageSlug = pathname.replace(/\/+$/, "").split("/").pop() || slug;
  const localAudio = firstPartyAudio(pageSlug);
  if (localAudio) {
    fm.audioUrl = localAudio;
    for (const remote of audioUrls) {
      markdown = markdown.split(remote).join(localAudio);
    }
    markdown = markdown.replace(
      /https?:\/\/(?:static1\.)?squarespace(?:usercontent)?\.com\/[^\s)"']+\.(?:mp3|mp4|m4a)/gi,
      localAudio
    );
  }

  const front = Object.entries(fm)
    .map(([k, v]) => {
      if (Array.isArray(v)) {
        if (!v.length) return null;
        return `${k}:\n${v.map((item) => `  - ${yamlEscape(item)}`).join("\n")}`;
      }
      return `${k}: ${yamlEscape(v)}`;
    })
    .filter(Boolean)
    .join("\n");

  const body = `---\n${front}\n---\n\n${markdown}\n`;

  let outPath;
  if (kind === "blog") {
    outPath = join(ROOT, "src/content/blog", `${pathname.slice("/blog/".length)}.md`);
  } else if (kind === "podcast") {
    outPath = join(ROOT, "src/content/podcast", `${pathname.slice("/podcast/".length)}.md`);
  } else if (kind === "book-summaries") {
    outPath = join(
      ROOT,
      "src/content/book-summaries",
      `${pathname.slice("/book-summaries/".length)}.md`
    );
  } else if (kind === "meta") {
    outPath = join(ROOT, "src/content/pages", `_index-${slug}.md`);
  } else {
    outPath = join(ROOT, "src/content/pages", `${pathname.replace(/^\//, "")}.md`);
  }

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, body, "utf8");
  report.written += 1;
  process.stdout.write(`  ✓ ${pathname}\n`);
}

async function pool(items, limit, worker) {
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

async function downloadSiteAssets() {
  const assets = [
    {
      url: "https://images.squarespace-cdn.com/content/v1/64fb40924ddf256063824bc3/711d5704-0c5d-45b3-bf3e-0c08ffec4451/favicon.ico?format=100w",
      dest: join(ROOT, "public/favicon.ico"),
    },
    {
      url: "https://images.squarespace-cdn.com/content/v1/64fb40924ddf256063824bc3/3d485189-f366-485e-b729-96252b4c45ef/K+Cadet.jpg?format=1500w",
      dest: join(ROOT, "public/images/site/k-cadet.jpg"),
    },
    {
      url: "https://images.squarespace-cdn.com/content/v1/64fb40924ddf256063824bc3/09bdf517-a73c-4336-a988-1e9419976d62/K9.jpg?format=1500w",
      dest: join(ROOT, "public/images/site/k9.jpg"),
    },
    {
      url: "https://images.squarespace-cdn.com/content/v1/64fb40924ddf256063824bc3/ae169684-bd3a-4660-955f-094f73812158/tree+1.jpg?format=1500w",
      dest: join(ROOT, "public/images/site/tree-1.jpg"),
    },
    {
      url: "https://images.squarespace-cdn.com/content/v1/64fb40924ddf256063824bc3/b713f2c4-4276-4e90-b175-f21a3ed454dc/Screenshot+2026-01-26+at+3.44.35%E2%80%AFPM.png?format=1200w",
      dest: join(ROOT, "public/images/site/og-default.png"),
    },
    {
      url: "https://images.squarespace-cdn.com/content/v1/64fb40924ddf256063824bc3/t/688eec096f6e084af57c1d24/1754197001079/Podcast+Square.png?format=800w",
      dest: join(ROOT, "public/images/site/podcast-cover.png"),
    },
  ];

  for (const asset of assets) {
    try {
      const res = await fetch(asset.url, { headers: { "User-Agent": UA } });
      if (!res.ok) throw new Error(`${res.status}`);
      await mkdir(dirname(asset.dest), { recursive: true });
      await writeFile(asset.dest, Buffer.from(await res.arrayBuffer()));
      report.images += 1;
      console.log(`  asset ${asset.dest.replace(ROOT, "")}`);
    } catch (err) {
      report.notes.push(`asset failed ${asset.url}: ${err.message}`);
    }
  }
}

async function main() {
  console.log("Fetching sitemap…");
  const xml = await fetchText(SITEMAP);
  const { locs, lastmods } = parseSitemap(xml);
  console.log(`Sitemap URLs: ${locs.length}`);

  await mkdir(join(ROOT, "src/content/pages"), { recursive: true });
  await mkdir(join(ROOT, "src/content/blog"), { recursive: true });
  await mkdir(join(ROOT, "src/content/podcast"), { recursive: true });
  await mkdir(join(ROOT, "src/content/book-summaries"), { recursive: true });
  await mkdir(join(ROOT, "public/images"), { recursive: true });

  console.log("Downloading site photography and favicon…");
  await downloadSiteAssets();

  const only = process.argv.slice(2).filter((arg) => arg.startsWith("http"));
  const urls = (only.length ? only : locs).filter((u) => u.startsWith(SITE));
  if (only.length) console.log(`Scraping ${urls.length} requested URL(s)`);
  await pool(urls, CONCURRENCY, async (url) => {
    try {
      await scrapePage(url, lastmods.get(url));
    } catch (err) {
      report.failed.push({ url, error: String(err?.message || err) });
      process.stdout.write(`  ✗ ${url} — ${err.message}\n`);
    }
  });

  const reportPath = join(ROOT, "scripts/scrape-report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log("\nDone.");
  console.log(`  fetched ${report.fetched}`);
  console.log(`  written ${report.written}`);
  console.log(`  images  ${report.images}`);
  console.log(`  failed  ${report.failed.length}`);
  console.log(`  skipped ${report.skipped.length}`);
  if (report.failed.length) {
    console.log("Failed pages:");
    for (const f of report.failed) console.log(`  - ${f.url}: ${f.error}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
