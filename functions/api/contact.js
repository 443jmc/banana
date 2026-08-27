const SUCCESS_MESSAGE = "Thank you for reaching out. I usually respond within 24 hours.";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function onRequestPost(context) {
  const contentType = context.request.headers.get("content-type") || "";
  let email = "";
  let message = "";
  let honeypot = "";

  if (contentType.includes("application/json")) {
    const body = await context.request.json();
    email = String(body.email || "");
    message = String(body.message || "");
    honeypot = String(body.website || "");
  } else {
    const form = await context.request.formData();
    email = String(form.get("email") || "");
    message = String(form.get("message") || "");
    honeypot = String(form.get("website") || "");
  }

  if (honeypot) {
    return json({ ok: true, message: SUCCESS_MESSAGE });
  }

  if (!email.includes("@") || message.trim().length < 2) {
    return json({ ok: false, error: "Please include a valid email and a message." }, 400);
  }

  const endpoint = context.env.FORMSPREE_URL || context.env.CONTACT_WEBHOOK_URL;
  if (!endpoint) {
    return json(
      {
        ok: false,
        error:
          "This form is not connected yet. Set FORMSPREE_URL or CONTACT_WEBHOOK_URL in the Cloudflare Pages environment variables.",
      },
      503
    );
  }

  const forwarded = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, message, source: "jamesmchristensen.com contact form" }),
  });

  if (!forwarded.ok) {
    return json({ ok: false, error: "Unable to submit form. Please try again later." }, 502);
  }

  return json({ ok: true, message: SUCCESS_MESSAGE });
}
