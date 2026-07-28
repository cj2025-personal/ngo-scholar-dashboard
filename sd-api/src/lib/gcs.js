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

function getStorageClient() {
  if (!storageClient) {
    storageClient = new Storage(buildStorageOptions());
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
  getEditorialImagesBucket,
  getStorageClient,
};
