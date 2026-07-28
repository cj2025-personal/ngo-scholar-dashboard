const express = require("express");

const { s3Client, S3_BUCKET, GetObjectCommand } = require("../config/s3");

const router = express.Router();

/**
 * GET /api/images/<s3-key>
 *
 * Streams a faculty headshot from the S3 archive through this API so the
 * scholar dashboard frontend can render it via a plain <img> tag without any
 * S3 credentials. Public (no auth) — the same headshots are already public on
 * the profile site, and <img> loads cannot carry the session cookie anyway.
 *
 * A RegExp route is used because the key contains slashes
 * ("profiles/<id>/profile.jpg") and Express 5 requires named wildcards; the
 * capture group lands in req.params[0].
 */
// Only faculty headshots live under this prefix; scoping the public proxy to it
// prevents streaming arbitrary objects from the bucket.
const ALLOWED_KEY_PREFIX = "profiles/";

router.get(/^\/(.+)/, async (req, res) => {
  // req.params[0] is already URL-decoded once by the Express router — do not
  // decode again or keys containing literal percent-escapes get corrupted.
  const key = req.params[0];

  // Reject empty keys, path traversal, and anything outside the headshot prefix.
  if (!key || key.includes("..") || !key.startsWith(ALLOWED_KEY_PREFIX)) {
    return res.status(400).json({ error: "Invalid image key" });
  }

  try {
    const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: key });
    const s3Response = await s3Client.send(command);

    res.set("Content-Type", s3Response.ContentType || "image/jpeg");
    if (s3Response.ContentLength) {
      res.set("Content-Length", String(s3Response.ContentLength));
    }
    // 1h in the browser, 24h at any shared cache.
    res.set("Cache-Control", "public, max-age=3600, s-maxage=86400");

    const body = s3Response.Body;
    body.pipe(res);
    body.on("error", () => {
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to stream image" });
      } else {
        res.destroy();
      }
    });
  } catch (error) {
    if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) {
      return res.status(404).json({ error: "Image not found" });
    }
    return res.status(500).json({ error: "Failed to fetch image" });
  }
});

module.exports = router;
