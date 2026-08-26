#!/usr/bin/env node
/**
 * Prove the cutover feeds: static files, no Squarespace enclosures,
 * and the Pages Functions return 200 application/rss+xml for ?format=rss.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import * as cheerio from "cheerio";
import { onRequest as blogOnRequest } from "../functions/blog.js";
import { onRequest as podcastOnRequest } from "../functions/podcast.js";

const ROOT = new URL("..", import.meta.url).pathname;

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`OK: ${message}`);
}

function mockAssets(files) {
  return {
    async fetch(input) {
      const url = typeof input === "string" ? input : input.url;
      const path = new URL(url, "https://jamesmchristensen.com").pathname;
      if (files[path]) {
        const body = await readFile(files[path]);
        const type = path.endsWith(".xml") ? "application/rss+xml" : "text/html";
        return new Response(body, { status: 200, headers: { "Content-Type": type } });
      }
      return new Response("not found", { status: 404 });
    },
  };
}

async function checkStaticFeed(rel, { title, items, enclosures, author }) {
  const path = join(ROOT, rel);
  if (!existsSync(path)) {
    fail(`missing ${rel}`);
    return;
  }
  const xml = await readFile(path, "utf8");
  const $ = cheerio.load(xml, { xmlMode: true });
  const actualTitle = $("channel > title").first().text();
  const count = $("channel > item").length;
  const enc = $("enclosure").length;
  if (actualTitle !== title) fail(`${rel} title "${actualTitle}" != "${title}"`);
  else ok(`${rel} title "${title}"`);
  if (count !== items) fail(`${rel} has ${count} items, expected ${items}`);
  else ok(`${rel} has ${items} items`);
  if (enclosures != null) {
    if (enc !== enclosures) fail(`${rel} has ${enc} enclosures, expected ${enclosures}`);
    else ok(`${rel} has ${enclosures} enclosures`);
  }
  if (author && !$("itunes\\:author, itunes:author").text().includes(author)) {
    fail(`${rel} missing itunes:author ${author}`);
  } else if (author) {
    ok(`${rel} itunes:author ${author}`);
  }
  const squarespaceEnc = [];
  $("enclosure").each((_, el) => {
    const url = $(el).attr("url") || "";
    if (/squarespace/i.test(url)) squarespaceEnc.push(url);
  });
  if (squarespaceEnc.length) fail(`Squarespace enclosure URLs remain:\n${squarespaceEnc.join("\n")}`);
  else ok(`${rel} enclosure URLs are first-party`);
}

async function checkFunction(handler, path, feedFile) {
  const assets = mockAssets({
    "/blog/rss.xml": join(ROOT, "public/blog/rss.xml"),
    "/podcast/rss.xml": join(ROOT, "public/podcast/rss.xml"),
    "/blog": join(ROOT, "dist/blog.html"),
    "/podcast": join(ROOT, "dist/podcast.html"),
  });

  const rssRes = await handler({
    request: new Request(`https://jamesmchristensen.com${path}?format=rss`),
    env: { ASSETS: assets },
  });
  const type = rssRes.headers.get("content-type") || "";
  const body = await rssRes.text();
  if (rssRes.status !== 200) fail(`${path}?format=rss status ${rssRes.status}`);
  else ok(`${path}?format=rss → ${rssRes.status}`);
  if (!type.includes("application/rss+xml")) fail(`${path}?format=rss content-type ${type}`);
  else ok(`${path}?format=rss content-type ${type}`);
  if (!body.includes("<rss")) fail(`${path}?format=rss body is not RSS`);
  else ok(`${path}?format=rss returned RSS body (${body.length} bytes)`);
  if (rssRes.status >= 300 && rssRes.status < 400) {
    fail(`${path}?format=rss must not redirect`);
  }

  const htmlRes = await handler({
    request: new Request(`https://jamesmchristensen.com${path}`),
    env: { ASSETS: assets },
  });
  if (htmlRes.status !== 200) fail(`${path} HTML status ${htmlRes.status}`);
  else ok(`${path} without query still served (${htmlRes.status})`);
}

async function checkPagesAudio() {
  const manifestPath = join(ROOT, "scripts/data/audio-manifest.json");
  if (!existsSync(manifestPath)) {
    fail("missing scripts/data/audio-manifest.json");
    return;
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const over = [];
  for (const item of manifest.items) {
    if (!item.localPath) continue;
    const st = await statIf(join(ROOT, item.localPath));
    if (!st) {
      fail(`missing ${item.localPath}`);
      continue;
    }
    if (st.size > 25 * 1024 * 1024) over.push(`${item.localPath} ${st.size}`);
  }
  if (over.length) fail(`Files over 25MB:\n${over.join("\n")}`);
  else ok("All published audio files are ≤ 25MB");

  const noEnc = manifest.items.filter((i) => !i.originalUrl);
  if (noEnc.length !== 1) fail(`Expected 1 item without enclosure, found ${noEnc.length}`);
  else ok(`Kept ${noEnc[0].slug} without an enclosure`);
  const dead = manifest.items.filter((i) => i.unavailable);
  if (dead.length) {
    ok(
      `Documented ${dead.length} live enclosure(s) already missing on Squarespace: ${dead
        .map((i) => i.slug)
        .join(", ")}`
    );
  }
}

async function statIf(path) {
  try {
    const { stat } = await import("node:fs/promises");
    return await stat(path);
  } catch {
    return null;
  }
}

async function main() {
  await checkStaticFeed("public/blog/rss.xml", {
    title: "Roseville Couples Therapy Blog",
    items: 20,
    enclosures: 0,
  });
  const manifestPath = join(ROOT, "scripts/data/audio-manifest.json");
  const manifest = existsSync(manifestPath)
    ? JSON.parse(await readFile(manifestPath, "utf8"))
    : { items: [] };
  const expectedEnclosures = manifest.items.filter((i) => i.publicUrl && !i.unavailable).length;

  await checkStaticFeed("public/podcast/rss.xml", {
    title: "Balance your Brain",
    items: 39,
    enclosures: expectedEnclosures || 37,
    author: "James Christensen",
  });
  await checkFunction(blogOnRequest, "/blog", "public/blog/rss.xml");
  await checkFunction(podcastOnRequest, "/podcast", "public/podcast/rss.xml");
  await checkPagesAudio();

  if (process.exitCode) {
    console.error("\nFeed verification failed.");
    process.exit(1);
  }
  console.log("\nFeed verification passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
