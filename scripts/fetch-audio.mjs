#!/usr/bin/env node
/**
 * Download every podcast enclosure from the live Squarespace RSS feed
 * into public/audio/ and rewrite episode pages to first-party URLs.
 *
 * Cloudflare Pages rejects files over 25MB. Episodes larger than that
 * are transcoded to speech-quality MP3 so they still ship first-party.
 *
 * Usage: npm run fetch-audio
 */
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import * as cheerio from "cheerio";
import { generateFeeds } from "./generate-feeds.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const SITE = "https://jamesmchristensen.com";
const PODCAST_RSS = `${SITE}/podcast?format=rss`;
const UA =
  "Mozilla/5.0 (compatible; RosevilleSiteImporter/1.0; +https://github.com/443jmc/banana)";
const PAGES_MAX_BYTES = 25 * 1024 * 1024;
const CONCURRENCY = 3;
const RETRIES = 3;

const CACHE_DIR = join(ROOT, "scripts/.cache/audio-originals");
const AUDIO_DIR = join(ROOT, "public/audio");
const MANIFEST_PATH = join(ROOT, "scripts/data/audio-manifest.json");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function extFromUrlOrType(url, type) {
  const path = new URL(url).pathname.toLowerCase();
  if (path.endsWith(".mp4")) return "mp4";
  if (path.endsWith(".m4a")) return "m4a";
  if (path.endsWith(".mp3")) return "mp3";
  if ((type || "").includes("mp4")) return "mp4";
  if ((type || "").includes("m4a") || (type || "").includes("mp4a")) return "m4a";
  return "mp3";
}

function publicType(ext) {
  if (ext === "mp4") return "video/mp4";
  if (ext === "m4a") return "audio/mp4";
  return "audio/mpeg";
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

function parsePodcastFeed(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const items = [];
  $("channel > item").each((_, el) => {
    const $i = $(el);
    const link = $i.children("link").first().text().trim();
    const title = $i.children("title").first().text().trim();
    const enclosure = $i.children("enclosure").first();
    const originalUrl = enclosure.attr("url") || "";
    const originalType = enclosure.attr("type") || "";
    const originalLength = Number(enclosure.attr("length") || 0) || 0;
    let slug = "";
    try {
      slug = decodeURIComponent(new URL(link).pathname.replace(/\/+$/, "").split("/").pop() || "");
    } catch {
      slug = "";
    }
    items.push({ title, link, slug, originalUrl, originalType, originalLength });
  });
  return items;
}

async function downloadTo(url, dest) {
  await mkdir(dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  let lastErr;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok || !res.body) throw new Error(`${res.status} ${url}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
      await rename(tmp, dest);
      return;
    } catch (err) {
      lastErr = err;
      console.warn(`  retry ${attempt}/${RETRIES} ${url}: ${err.message}`);
      await sleep(1000 * attempt);
    }
  }
  throw lastErr;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`));
    });
  });
}

async function transcodeUnderLimit(input, outputMp3) {
  const tmp = `${outputMp3}.tmp.mp3`;
  const bitrates = [96, 80, 64, 56, 48, 40, 32];
  let lastSize = Infinity;
  for (const rate of bitrates) {
    await runFfmpeg([
      "-y",
      "-i",
      input,
      "-vn",
      "-codec:a",
      "libmp3lame",
      "-b:a",
      `${rate}k`,
      "-ac",
      "1",
      "-ar",
      "44100",
      tmp,
    ]);
    const size = (await stat(tmp)).size;
    lastSize = size;
    if (size <= PAGES_MAX_BYTES) {
      await rename(tmp, outputMp3);
      return { bytes: size, bitrate: rate };
    }
    console.warn(`  ${rate}k still ${size} bytes, trying lower bitrate`);
  }
  throw new Error(`Could not fit under 25MB (last size ${lastSize})`);
}

async function publishFile(item, originalPath) {
  const originalStat = await stat(originalPath);
  const originalExt = extFromUrlOrType(item.originalUrl, item.originalType);
  const underLimit = originalStat.size <= PAGES_MAX_BYTES;

  if (underLimit) {
    const dest = join(AUDIO_DIR, `${item.slug}.${originalExt}`);
    await copyFile(originalPath, dest);
    return {
      localPath: `public/audio/${item.slug}.${originalExt}`,
      publicUrl: `${SITE}/audio/${item.slug}.${originalExt}`,
      bytes: originalStat.size,
      type: item.originalType || publicType(originalExt),
      transcoded: false,
      reason: null,
    };
  }

  const dest = join(AUDIO_DIR, `${item.slug}.mp3`);
  const result = await transcodeUnderLimit(originalPath, dest);
  return {
    localPath: `public/audio/${item.slug}.mp3`,
    publicUrl: `${SITE}/audio/${item.slug}.mp3`,
    bytes: result.bytes,
    type: "audio/mpeg",
    transcoded: true,
    reason: `Original ${originalStat.size} bytes exceeds Cloudflare Pages 25MB limit; transcoded to ${result.bitrate}k mono MP3.`,
  };
}

async function rewritePodcastMarkdown(items) {
  const bySlug = new Map(items.filter((i) => i.publicUrl).map((i) => [i.slug, i]));
  const dir = join(ROOT, "src/content/podcast");
  const { readdir } = await import("node:fs/promises");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  let changed = 0;

  for (const file of files) {
    const slug = file.replace(/\.md$/, "");
    const item = bySlug.get(slug);
    const path = join(dir, file);
    let text = await readFile(path, "utf8");
    const before = text;

    if (item?.originalUrl && item.publicUrl) {
      const local = item.publicUrl.replace(SITE, "") || item.publicUrl;
      text = text.split(item.originalUrl).join(local);
    }

    text = text.replace(
      /https?:\/\/(?:static1\.)?squarespace(?:usercontent)?\.com\/[^\s"'<>]+/gi,
      (url) => {
        if (!/\.(mp3|mp4|m4a|wav|aac)(\?|$)/i.test(url) && !url.includes("/t/")) return url;
        if (item?.publicUrl) return item.publicUrl.replace(SITE, "");
        return url;
      }
    );

    if (item?.publicUrl) {
      const local = item.publicUrl.replace(SITE, "");
      if (/^audioUrl:/.test(text) || /\naudioUrl:/.test(text)) {
        text = text.replace(/^audioUrl:.*$/m, `audioUrl: "${local}"`);
      } else if (item.originalUrl) {
        text = text.replace(/^(---\n)/, `$1audioUrl: "${local}"\n`);
      }
    }

    if (text !== before) {
      await writeFile(path, text);
      changed += 1;
    }
  }
  return changed;
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

export async function fetchAudio() {
  await mkdir(CACHE_DIR, { recursive: true });
  await mkdir(AUDIO_DIR, { recursive: true });
  await mkdir(join(ROOT, "scripts/data"), { recursive: true });

  console.log("Fetching live podcast RSS…");
  const xml = await fetchText(PODCAST_RSS);
  await writeFile(join(ROOT, "scripts/.cache/podcast.rss.xml"), xml);
  const items = parsePodcastFeed(xml);
  console.log(`${items.length} items`);

  const withAudio = items.filter((i) => i.originalUrl);
  const missing = items.filter((i) => !i.originalUrl);
  for (const item of missing) {
    console.log(`  no enclosure (kept): ${item.slug || item.title}`);
  }

  await pool(withAudio, CONCURRENCY, async (item) => {
    const origExt = extFromUrlOrType(item.originalUrl, item.originalType);
    const originalPath = join(CACHE_DIR, `${item.slug}.${origExt}`);
    const already = existsSync(originalPath) ? await stat(originalPath) : null;
    const expected = item.originalLength;
    const fresh =
      already &&
      already.size > 1000 &&
      (expected === 0 || Math.abs(already.size - expected) < 2048 || already.size >= expected * 0.9);

    if (fresh) {
      console.log(`  cached ${item.slug} (${already.size} bytes)`);
    } else {
      console.log(`  download ${item.slug}`);
      await downloadTo(item.originalUrl, originalPath);
    }

    const published = await publishFile(item, originalPath);
    Object.assign(item, published);
    console.log(
      `  → ${item.localPath} ${item.bytes} bytes${item.transcoded ? " (transcoded)" : ""}`
    );
  });

  const manifest = {
    generatedAt: new Date().toISOString(),
    origin: SITE,
    pagesMaxBytes: PAGES_MAX_BYTES,
    items: items.map((item) => ({
      slug: item.slug,
      title: item.title,
      link: item.link,
      originalUrl: item.originalUrl || null,
      originalType: item.originalType || null,
      originalLength: item.originalLength || 0,
      localPath: item.localPath || null,
      publicUrl: item.publicUrl || null,
      bytes: item.bytes || 0,
      type: item.type || null,
      transcoded: !!item.transcoded,
      reason: item.reason || null,
    })),
  };
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`Wrote ${MANIFEST_PATH}`);

  const rewritten = await rewritePodcastMarkdown(manifest.items);
  console.log(`Rewrote ${rewritten} podcast markdown files`);

  await generateFeeds({ podcastXml: xml, manifest });
  return manifest;
}

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("fetch-audio.mjs");
if (isMain) {
  fetchAudio().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
