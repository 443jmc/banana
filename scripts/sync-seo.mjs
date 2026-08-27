#!/usr/bin/env node
/**
 * Pull live <title> and meta description into content frontmatter (seoTitle + description).
 * Does not rewrite page bodies.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SITE = "https://jamesmchristensen.com";
const UA =
  "Mozilla/5.0 (compatible; RosevilleSiteImporter/1.0; +https://github.com/443jmc/banana)";

function decodeHtml(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function yamlEscape(value) {
  const s = String(value);
  if (s === "") return '""';
  if (/[:#\n"'{}[\],&*?|<>=!%@`]/.test(s) || s !== s.trim()) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
  }
  return s;
}

function fileForPath(pathname) {
  if (pathname === "/" || pathname === "/blog" || pathname === "/podcast" || pathname === "/book-summaries") {
    return null;
  }
  if (pathname.startsWith("/blog/")) {
    return join(ROOT, "src/content/blog", `${pathname.slice("/blog/".length)}.md`);
  }
  if (pathname.startsWith("/podcast/")) {
    return join(ROOT, "src/content/podcast", `${pathname.slice("/podcast/".length)}.md`);
  }
  if (pathname.startsWith("/book-summaries/")) {
    return join(
      ROOT,
      "src/content/book-summaries",
      `${pathname.slice("/book-summaries/".length)}.md`
    );
  }
  return join(ROOT, "src/content/pages", `${pathname.replace(/^\//, "")}.md`);
}

function setFrontmatter(raw, updates) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return raw;
  let fm = match[1];
  for (const [key, value] of Object.entries(updates)) {
    if (value == null) continue;
    const line = `${key}: ${yamlEscape(value)}`;
    const re = new RegExp(`^${key}:.*$`, "m");
    if (re.test(fm)) fm = fm.replace(re, line);
    else fm += `\n${line}`;
  }
  return `---\n${fm}\n---\n${raw.slice(match[0].length)}`;
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

async function main() {
  const xml = await fetchText(`${SITE}/sitemap.xml`);
  const locs = [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)].map((m) => m[1].trim());
  const skip = new Set([`${SITE}/cart`, `${SITE}/404`, `${SITE}/home`, `${SITE}/`]);
  const urls = locs.filter((u) => !skip.has(u.replace(/\/$/, "")));
  let updated = 0;
  let missing = 0;

  for (const url of urls) {
    const pathname = new URL(url).pathname.replace(/\/$/, "") || "/";
    const file = fileForPath(pathname);
    if (!file) continue;
    let raw;
    try {
      raw = await readFile(file, "utf8");
    } catch {
      missing += 1;
      console.log(`  missing file for ${pathname}`);
      continue;
    }
    try {
      const html = await fetchText(url);
      const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
      const descMatch = html.match(/name="description"\s+content="([^"]*)"/i);
      const seoTitle = titleMatch ? decodeHtml(titleMatch[1].replace(/\s+/g, " ").trim()) : "";
      const description = descMatch ? decodeHtml(descMatch[1].trim()) : "";
      const updates = {};
      if (seoTitle) updates.seoTitle = seoTitle;
      if (description) updates.description = description;
      if (Object.keys(updates).length) {
        await writeFile(file, setFrontmatter(raw, updates));
        updated += 1;
        process.stdout.write(`  ✓ ${pathname}\n`);
      }
    } catch (err) {
      console.log(`  ✗ ${pathname}: ${err.message}`);
    }
  }
  console.log(`Updated ${updated} files. Missing files: ${missing}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
