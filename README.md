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

Podcast episode audio files are linked from the public Squarespace CDN (they are ~15–20 MB each and exceed a comfortable git / Cloudflare file budget). YouTube embeds on `/videos` and episode pages are preserved.

Intentionally skipped live routes:

- `/cart` (commerce)
- `/workshop-old`
- `/home` (redirects to `/`)
- `/404` (this site has its own 404 page)
- `/course-communication` (legacy course page, not in the nav)

The last import wrote **138 blog posts**, **39 podcast episodes**, **32 book summaries**, and the static service/resource pages. No page fetches failed. `scripts/scrape-report.json` is generated locally when you re-run the importer.

The live FAQ currently says additional 50-minute sessions are **$250**; the live homepage says additional sessions are **$300**. Both lines were copied as published. Confirm the current fee before launch.

## Design notes

The look is taken from the live Squarespace 7.1 theme:

- Header wash: `#c2c8cc`
- Warm paper / photography sections: `#e7d9cb` / `#f7f3ee`
- Olive ink: `#3d4435`
- Headings: Young Serif
- Body (including italic/bold): Bitter

Photography on the homepage (`K+Cadet.jpg`, `K9.jpg`, `tree+1.jpg`) and the favicon are downloaded locally so the clone does not hotlink the Squarespace CDN.

## Trailing slashes

Astro is configured with `trailingSlash: 'never'` and `build.format: 'file'`. `public/_redirects` sends `/home` → `/` and strips trailing slashes on Cloudflare Pages.
