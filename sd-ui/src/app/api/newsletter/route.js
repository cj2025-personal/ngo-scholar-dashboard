import { PUBLIC_SITE_URL } from "@/lib/brand";

/*
 * The footer's newsletter sign-up (components/landing/NewsletterForm.js),
 * handed to the public site's own endpoint (ngo-web src/app/api/newsletter),
 * so a sign-up from the studio is recorded where the site's are. Server to
 * server: the site sends no CORS headers, so a browser on the studio's
 * address cannot post there itself.
 *
 * The site validates the address and answers in its own words; this passes
 * its answer back. Only the address and where it came from are sent.
 */
const SOURCE = "inkvyn-footer";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email = typeof body?.email === "string" ? body.email.trim().slice(0, 320) : "";
  if (!email) {
    return Response.json({ error: "Please enter an email address." }, { status: 400 });
  }

  try {
    const res = await fetch(`${PUBLIC_SITE_URL}/api/newsletter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, source: SOURCE }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json().catch(() => ({}));
    const answer = {};
    if (typeof data.error === "string") answer.error = data.error;
    if (typeof data.message === "string") answer.message = data.message;
    return Response.json(answer, { status: res.ok ? 200 : res.status >= 500 ? 502 : res.status });
  } catch {
    return Response.json({ error: "We couldn't reach the server. Please try again." }, { status: 502 });
  }
}
