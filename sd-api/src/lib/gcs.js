const fs = require("fs");
const path = require("path");

const { Storage } = require("@google-cloud/storage");

const { env } = require("../config/env");
const { ApiError } = require("./api-error");

let storageClient;

function resolveKeyFilename(inputPath) {
  if (!inputPath) {
    return null;
  }

  const resolvedPath = path.resolve(inputPath);

  if (!fs.existsSync(resolvedPath)) {
    return inputPath;
  }

  const stats = fs.statSync(resolvedPath);

  if (stats.isFile()) {
    return resolvedPath;
  }

  if (!stats.isDirectory()) {
    return inputPath;
  }

  const jsonFiles = fs
    .readdirSync(resolvedPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => path.join(resolvedPath, entry.name));

  if (jsonFiles.length === 1) {
    return jsonFiles[0];
  }

  throw new ApiError(
    500,
    "GCP service account directory must contain exactly one JSON key file.",
  );
}

function buildStorageOptions() {
  const options = {};

  if (env.gcpProjectId) {
    options.projectId = env.gcpProjectId;
  }

  if (env.gcpServiceAccountJson) {
    try {
      options.credentials = JSON.parse(env.gcpServiceAccountJson);
    } catch {
      throw new ApiError(500, "GCP service account JSON is invalid.");
    }
  } else if (env.gcpServiceAccountKeyFile) {
    options.keyFilename = resolveKeyFilename(env.gcpServiceAccountKeyFile);
  }

  return options;
}

/**
 * An in-memory stand-in for Cloud Storage, selected with the fake model.
 *
 * The end-to-end suites upload the illustrations the story agent generates
 * and stream them back through the image routes; they must not need a
 * bucket to do it. Same surface the service uses: bucket name, save,
 * metadata, delete, read stream. Never selected in production.
 */
function createFakeStorage(bucketName) {
  const { Readable } = require("stream");
  const files = new Map();
  const bucket = {
    name: bucketName,
    file(name) {
      return {
        async save(buffer, options = {}) {
          files.set(name, { buffer: Buffer.from(buffer), contentType: options.contentType || "application/octet-stream" });
        },
        async getMetadata() {
          const f = files.get(name);
          return [{ generation: "1", metageneration: "1", etag: "fake", md5Hash: null, crc32c: null, cacheControl: null, contentType: f?.contentType, size: f ? f.buffer.length : 0 }];
        },
        async delete() {
          files.delete(name);
        },
        createReadStream() {
          const f = files.get(name);
          return Readable.from(f ? [f.buffer] : []);
        },
      };
    },
  };
  return { bucket: () => bucket };
}

function getStorageClient() {
  if (!storageClient) {
    storageClient =
      env.llm?.provider === "fake" && !env.isProduction
        ? createFakeStorage(env.gcpEditorialImagesBucket)
        : new Storage(buildStorageOptions());
  }

  return storageClient;
}

function getEditorialImagesBucket() {
  const bucketName = env.gcpEditorialImagesBucket;

  if (!bucketName) {
    throw new ApiError(500, "GCP editorial images bucket is not configured.");
  }

  return getStorageClient().bucket(bucketName);
}

module.exports = {
  resolveKeyFilename,
  getEditorialImagesBucket,
  getStorageClient,
};
