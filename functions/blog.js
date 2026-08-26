/**
 * Serve the blog RSS body at the live Squarespace URL:
 *   GET /blog?format=rss  →  200 application/rss+xml
 *
 * Podcast apps often mishandle redirects, so this is not a 301/302.
 * /blog without the query still returns the static HTML page.
 */
const RSS_HEADERS = {
  "Content-Type": "application/rss+xml; charset=utf-8",
  "Cache-Control": "public, max-age=3600",
};

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (url.searchParams.get("format") === "rss") {
    const rss = await context.env.ASSETS.fetch(new URL("/blog/rss.xml", url.origin));
    if (!rss.ok) {
      return new Response("Blog feed unavailable", { status: 500 });
    }
    return new Response(rss.body, { status: 200, headers: RSS_HEADERS });
  }
  return context.env.ASSETS.fetch(context.request);
}
