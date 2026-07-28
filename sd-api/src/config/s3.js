const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");

// Faculty headshots live in the shared S3 archive. The scholar dashboard
// proxies them through its own API (see routes/images.js) so the frontend
// never needs S3 credentials and stays self-contained.
const S3_BUCKET = process.env.S3_BUCKET_NAME || "faculty-images-archive-y";
const AWS_REGION = process.env.AWS_REGION || "us-east-1";

const s3Client = new S3Client({
  region: AWS_REGION,
  ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
      }
    : {}),
});

/**
 * Parse an s3:// URI into { bucket, key }. Returns null for non-S3 values.
 */
function parseS3Uri(uri) {
  if (!uri || typeof uri !== "string" || !uri.startsWith("s3://")) {
    return null;
  }

  const withoutScheme = uri.slice(5); // strip "s3://"
  const slashIndex = withoutScheme.indexOf("/");
  if (slashIndex < 0) {
    return null;
  }

  return {
    bucket: withoutScheme.slice(0, slashIndex),
    key: withoutScheme.slice(slashIndex + 1),
  };
}

/**
 * Normalise a faculty-image reference into a root-relative proxy path that
 * this API serves at GET /api/images/<key>.
 *  - "/api/images/<key>"  -> returned unchanged (already a proxy path)
 *  - "s3://bucket/<key>"   -> "/api/images/<key>"
 *  - anything else (http)  -> "" (caller decides how to treat external URLs)
 */
function toImageProxyPath(value) {
  if (!value || typeof value !== "string") {
    return "";
  }
  if (value.startsWith("/api/images/")) {
    return value;
  }
  if (!value.startsWith("s3://")) {
    return "";
  }

  const parsed = parseS3Uri(value);
  if (!parsed) {
    return "";
  }

  return `/api/images/${parsed.key}`;
}

module.exports = {
  s3Client,
  S3_BUCKET,
  GetObjectCommand,
  parseS3Uri,
  toImageProxyPath,
};
