const express = require("express");

const { s3Client, S3_BUCKET, GetObjectCommand } = require("../config/s3");
const { getDb } = require("../db/mongo");
const { canonicalScholarId, scholarFilter } = require("../lib/identity");
const { optionalAuth } = require("../middleware/auth.middleware");
const { resolveScholarPhoto } = require("../services/profile.service");

const router = express.Router();

/**
 * GET /api/images/<s3-key>
 *
 * Streams a faculty headshot from the S3 archive through this API so the
 * studio can show a scholar their own photo via a plain <img> tag without any
 * S3 credentials.
 *
 * ── The scholar's own, and nobody else's ───────────────────────────────────
 * This used to be public, on the reasoning that the same headshots were public
 * on the profile site. They are not any more: these photos were harvested, and
 * under the consent layer (lib/scholarConsent) no photo is shown without a
 * recorded basis, and a basis never covers this archive. So the one person
 * this route serves is the signed-in scholar whose photo it is, for their own
 * profile page; to anyone else it answers 404, as if the key did not exist, so
 * a direct link cannot leak it. Same-site <img> loads carry the session cookie
 * (SameSite=Lax, or None on Cloud Run), which is what makes this possible.
 *
 * A RegExp route is used because the key contains slashes
 * ("profiles/<id>/profile.jpg") and Express 5 requires named wildcards; the
 * capture group lands in req.params[0].
 */
// Only faculty headshots live under this prefix; scoping the proxy to it
// prevents streaming arbitrary objects from the bucket.
const ALLOWED_KEY_PREFIX = "profiles/";
const PROXY_PREFIX = "/api/images/";

function decodedOrSame(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** The archive key of the signed-in scholar's own photo, as their profile names it, or null. */
async function ownHeadshotKey(req) {
  const profileId = req.auth ? canonicalScholarId(req.auth.user) : null;
  if (!profileId) return null;
  const db = await getDb();
  const scholar = await db.collection("scholars").findOne(scholarFilter(profileId), { projection: { faculty_image: 1, "about.avatar_url": 1 } });
  const photo = resolveScholarPhoto(scholar);
  return photo && !photo.external && photo.url.startsWith(PROXY_PREFIX) ? photo.url.slice(PROXY_PREFIX.length) : null;
}

router.get(/^\/(.+)/, optionalAuth, async (req, res) => {
  // req.params[0] is already URL-decoded once by the Express router — do not
  // decode again or keys containing literal percent-escapes get corrupted.
  const key = req.params[0];

  // Reject empty keys, path traversal, and anything outside the headshot prefix.
  if (!key || key.includes("..") || !key.startsWith(ALLOWED_KEY_PREFIX)) {
    return res.status(400).json({ error: "Invalid image key" });
  }

  try {
    /* The stored path is compared both as written and decoded once, the
       way the router hands the key over. */
    const own = await ownHeadshotKey(req);
    if (!own || (key !== own && key !== decodedOrSame(own))) {
      return res.status(404).json({ error: "Image not found" });
    }
  } catch {
    return res.status(500).json({ error: "Failed to fetch image" });
  }

  try {
    const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: key });
    const s3Response = await s3Client.send(command);

    res.set("Content-Type", s3Response.ContentType || "image/jpeg");
    if (s3Response.ContentLength) {
      res.set("Content-Length", String(s3Response.ContentLength));
    }
    // An hour in the scholar's own browser, and never in a shared cache: the
    // answer depends on who is asking.
    res.set("Cache-Control", "private, max-age=3600");
    res.set("Vary", "Cookie");

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
