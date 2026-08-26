/**
 * Host-level cutover: www to apex. Path-level trailing slashes are in
 * public/_redirects (splat 301). RSS query strings are handled by
 * functions/blog.js and functions/podcast.js (200, not a redirect).
 */
export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (url.hostname === "www.jamesmchristensen.com") {
    url.hostname = "jamesmchristensen.com";
    url.protocol = "https:";
    return Response.redirect(url.toString(), 301);
  }
  return context.next();
}
