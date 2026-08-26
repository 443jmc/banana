# Roseville Couples Counseling

A static clone of [jamesmchristensen.com](https://jamesmchristensen.com) (James Christensen LMFT / Roseville Couples Counseling), rebuilt in Astro for Cloudflare Pages.

This is the practice’s own site. Copy, photography, and routes were imported from the live Squarespace site.

## Stack

- **Astro** (static output) → `dist/`
- Vanilla CSS, **Young Serif** + **Bitter** via Google Fonts
- Markdown content collections: `pages`, `blog`, `podcast`, `book-summaries`
- Cloudflare Pages Function at `/api/contact` (optional Formspree/webhook)

## Local development

Requires **Node 22** (see `.nvmrc`).

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

The build writes a static site to `dist/`. Preview with `npm run preview`.

## Publish on GitHub + Cloudflare Pages

1. Push this repo to GitHub (this repository: `443jmc/banana`).
2. In [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
3. Select the `banana` repo.
4. Build settings:
   - **Framework preset:** None (or Astro)
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Root directory:** `/` (leave empty)
   - **Node version:** `22` (set environment variable `NODE_VERSION=22` if the preset does not)
5. Deploy from the `main` branch (merge this PR first), or point Pages at this branch for a preview.
6. After the first deploy, add the custom domain `jamesmchristensen.com` under **Custom domains**. Update `PUBLIC_SITE_URL` if the canonical host should be the Pages URL during testing.

Optional environment variables (Pages → Settings → Environment variables):

| Name | Purpose |
| --- | --- |
| `PUBLIC_SITE_URL` | Canonical origin for sitemap + Open Graph (default `https://jamesmchristensen.com`) |
| `FORMSPREE_URL` | Formspree endpoint, e.g. `https://formspree.io/f/xxxxxx` |
| `CONTACT_WEBHOOK_URL` | Alternate POST webhook for the contact form |

The contact form POSTs to `/api/contact`. It does **not** fake a successful send. Until one of those env vars is set, the function returns HTTP 503 and the page tells the visitor to call 916-292-8920.

## RSS feeds (Squarespace cutover)

Squarespace served RSS at query-string URLs. Those exact URLs must keep working after Squarespace is turned off — static hosts otherwise ignore `?format=rss` and would 404 or return HTML.

| Feed | Live URL (keep this) | Static alias | Channel title |
| --- | --- | --- | --- |
| Blog | `https://jamesmchristensen.com/blog?format=rss` | `/blog/rss.xml` | Roseville Couples Therapy Blog (20 items, no enclosures) |
| Podcast | `https://jamesmchristensen.com/podcast?format=rss` | `/podcast/rss.xml` | Balance your Brain (`itunes:author` James Christensen; 39 items) |

Both URLs return **HTTP 200** with `Content-Type: application/rss+xml` and the feed body. They are **not** redirects. Cloudflare Pages Functions `functions/blog.js` and `functions/podcast.js` detect `format=rss` and serve the static XML from `public/blog/rss.xml` and `public/podcast/rss.xml`. `/blog` and `/podcast` without the query still return the HTML collection pages.

`/blog` and `/podcast` include `<link rel="alternate" type="application/rss+xml">` pointing at the live query-string URLs above.

Regenerate the committed XML from the live Squarespace feeds (while they still exist) with:

```bash
npm run generate-feeds
```

After Squarespace is off, edit the files in `public/blog/rss.xml` and `public/podcast/rss.xml` (or re-run generate against the cached copies in `scripts/.cache/`).

## Podcast audio (first-party, not Squarespace)

Live enclosures pointed at `static1.squarespace.com` (~7–90 MB each). Those URLs die when Squarespace is cancelled.

Every enclosure is now first-party:

`https://jamesmchristensen.com/audio/<slug>.mp3`

(or `.mp4` for the one episode whose live enclosure was `video/mp4`). Episode **13: The Power of Authenticity** has no enclosure in the live feed; that item is kept without audio rather than inventing a file.

On-page `<audio>` players and download links use the same `/audio/<slug>.*` paths.

### Cloudflare Pages 25MB limit

Pages rejects files over 25MB. Several live episodes are larger than that (the feed listed many in the 25–90MB range, not uniformly ~17MB). `npm run fetch-audio` downloads the originals into `scripts/.cache/audio-originals/` (gitignored), then:

- copies files ≤25MB into `public/audio/` unchanged
- transcodes files >25MB to speech-quality mono MP3 so each published file stays under 25MB

No episode is skipped. `scripts/data/audio-manifest.json` records original size, published path, and which files were transcoded.

To serve the uncompressed originals later, put those objects in **Cloudflare R2** and point the enclosure URLs at the R2 public domain (or a Worker in front of `/audio/*`). Until then, the transcoded first-party files are what podcast apps get.

### Git

Published files in `public/audio/` are each under 25MB, so they are **committed to git directly** (not Git LFS). The repo is larger because of the audio, but GitHub will accept the files. Switch to Git LFS only if a future push is rejected for size.

```bash
npm run fetch-audio    # download + transcode + rewrite pages + regenerate feeds
npm run verify-feeds   # static XML + Pages Function 200/rss checks
```

## Booking

Every Get Started / schedule CTA uses the live SimplePractice URL:

`https://james.clientsecure.me/request/service`

## Re-importing Squarespace content

```bash
npm run scrape
```

The importer (`scripts/scrape.mjs`):

1. Fetches `https://jamesmchristensen.com/sitemap.xml`
2. Fetches each page
3. Strips Squarespace chrome and keeps main copy, images, audio, and embeds
4. Downloads images into `public/images/`
5. Writes Markdown into `src/content/`

Podcast episode audio is first-party (`public/audio/`, see above). YouTube embeds on `/videos` and episode pages are preserved. After a re-scrape, run `npm run fetch-audio` so on-page players keep using `/audio/<slug>` instead of Squarespace.

Public URL paths match the live Squarespace sitemap so the custom domain can cut over without 404s. That includes `/course-communication` and `/workshop-old` as real pages (not redirects). `/home` still redirects to `/`. `/cart` is omitted (commerce). The built 404 page is not a published sitemap URL.

`scripts/sync-seo.mjs` pulls live `<title>` tags into `seoTitle` and live meta descriptions into `description` when they exist.

The last import wrote **138 blog posts**, **39 podcast episodes**, **32 book summaries**, and the static service/resource pages, plus the two sitemap pages above. No page fetches failed. `scripts/scrape-report.json` is generated locally when you re-run the importer.

The live FAQ currently says additional 50-minute sessions are **$250**; the live homepage says additional sessions are **$300**. Both lines were copied as published. Confirm the current fee before launch.

## Design notes

The look is taken from the live Squarespace 7.1 theme:

- Header wash: `#c2c8cc`
- Warm paper / photography sections: `#e7d9cb` / `#f7f3ee`
- Olive ink: `#3d4435`
- Headings: Young Serif
- Body (including italic/bold): Bitter

Photography on the homepage (`K+Cadet.jpg`, `K9.jpg`, `tree+1.jpg`) and the favicon are downloaded locally so the clone does not hotlink the Squarespace CDN.

## Trailing slashes and SEO

Astro is configured with `trailingSlash: 'never'` and `build.format: 'file'`. Canonicals and the generated sitemap use `https://jamesmchristensen.com{path}` with no trailing slash (homepage is `https://jamesmchristensen.com`). `public/_redirects` sends `/home` → `/` and strips trailing slashes on Cloudflare Pages. `robots.txt` allows crawling and points at `https://jamesmchristensen.com/sitemap-index.xml`.
