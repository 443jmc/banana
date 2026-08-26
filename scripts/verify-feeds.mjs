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
import { onRequest as hostMiddleware } from "../functions/_middleware.js";

const ROOT = new URL("..", import.meta.url).pathname;

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`OK: ${message}`);
}

function requestHref(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (input && typeof input.url === "string") return input.url;
  if (input && typeof input.href === "string") return input.href;
  return String(input);
}

function mockAssets(files) {
  return {
    async fetch(input) {
      const path = new URL(requestHref(input), "https://jamesmchristensen.com").pathname;
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
  if (author && !xml.includes(`<itunes:author>${author}</itunes:author>`)) {
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

  const slashRss = await handler({
    request: new Request(`https://jamesmchristensen.com${path}/?format=rss`),
    env: { ASSETS: assets },
  });
  if (slashRss.status !== 200 || !(slashRss.headers.get("content-type") || "").includes("application/rss+xml")) {
    fail(`${path}/?format=rss must stay 200 RSS (got ${slashRss.status} ${slashRss.headers.get("content-type")})`);
  } else {
    ok(`${path}/?format=rss → 200 RSS (not a redirect)`);
  }

  const slashHtml = await handler({
    request: new Request(`https://jamesmchristensen.com${path}/`),
    env: { ASSETS: assets },
  });
  if (slashHtml.status !== 301) fail(`${path}/ HTML status ${slashHtml.status}, expected 301`);
  else ok(`${path}/ → 301 ${slashHtml.headers.get("location")}`);
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

async function checkHostRedirect() {
  const redirected = await hostMiddleware({
    request: new Request("https://www.jamesmchristensen.com/blog?format=rss"),
    next: async () => new Response("should not run", { status: 500 }),
  });
  if (redirected.status !== 301) fail(`www host redirect status ${redirected.status}`);
  else if (redirected.headers.get("location") !== "https://jamesmchristensen.com/blog?format=rss") {
    fail(`www host redirect location ${redirected.headers.get("location")}`);
  } else {
    ok("www.jamesmchristensen.com → https://jamesmchristensen.com (query preserved)");
  }

  let nextCalled = false;
  const passed = await hostMiddleware({
    request: new Request("https://jamesmchristensen.com/blog?format=rss"),
    next: async () => {
      nextCalled = true;
      return new Response("ok", { status: 200 });
    },
  });
  if (!nextCalled || passed.status !== 200) fail("apex host must fall through to RSS functions");
  else ok("apex host falls through to the next handler");
}

async function checkBuiltHtml() {
  const index = join(ROOT, "dist/index.html");
  const blog = join(ROOT, "dist/blog.html");
  if (!existsSync(index)) {
    console.log("SKIP: dist/index.html not built yet (run npm run build)");
    return;
  }
  const html = await readFile(index, "utf8");
  const needles = [
    "G-FL14YETXQW",
    "GTM-TLB6DLP9",
    "523134667361670",
    'name="facebook-domain-verification"',
    "6trlgtc8wro0905iwbk9ha5nms0ms4",
    '"@type":"MedicalBusiness"',
    "LMFT #142990",
    '"@type":"WebSite"',
    "https://connect.facebook.net/en_US/fbevents.js",
  ];
  for (const needle of needles) {
    if (!html.includes(needle)) fail(`dist/index.html missing ${needle}`);
    else ok(`dist/index.html includes ${needle}`);
  }
  if (existsSync(blog)) {
    const blogHtml = await readFile(blog, "utf8");
    if (!blogHtml.includes("G-FL14YETXQW") || !blogHtml.includes("MedicalBusiness")) {
      fail("dist/blog.html missing site-wide tracking or JSON-LD");
    } else {
      ok("dist/blog.html also has tracking + MedicalBusiness JSON-LD");
    }
  }

  const redirects = await readFile(join(ROOT, "public/_redirects"), "utf8");
  if (!redirects.includes("/*/ /:splat 301")) fail("public/_redirects missing trailing-slash splat");
  else ok("public/_redirects has /*/ /:splat 301");
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
  await checkHostRedirect();
  await checkBuiltHtml();

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
