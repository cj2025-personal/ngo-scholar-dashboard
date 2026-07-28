const path = require("path");

const { ObjectId } = require("mongodb");
const sanitizeHtml = require("sanitize-html");

const { env } = require("../config/env");
const { COLLECTIONS, getDb } = require("../db/mongo");
const { ApiError } = require("../lib/api-error");
const { getEditorialImagesBucket } = require("../lib/gcs");
const { serializeMongoValue } = require("../lib/serialize");

const STORY_COLLECTION = COLLECTIONS.scholarStories;
const IMAGE_ASSET_COLLECTION = COLLECTIONS.editorialImageAssets;
const MAX_IMAGE_COUNT = 16;
const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "subheading",
  "quote",
  "image",
]);
const IMAGE_WIDTHS = new Set(["body", "wide", "full"]);
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
]);
const INLINE_SANITIZE_OPTIONS = {
  allowedTags: ["strong", "em", "u", "s", "code", "br", "a"],
  allowedAttributes: {
    a: ["href", "target", "rel"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: {
        href: attribs.href,
        target: "_blank",
        rel: "noreferrer noopener",
      },
    }),
  },
};

function buildScholarStoryFilters({ scholarId, profileId }) {
  const filters = [
    { scholar_id: scholarId },
    { profile_id: profileId },
    { authorId: scholarId },
    { authorId: profileId },
  ];

  if (ObjectId.isValid(scholarId)) {
    filters.push({ authorId: new ObjectId(scholarId) });
  }

  if (ObjectId.isValid(profileId)) {
    filters.push({ authorId: new ObjectId(profileId) });
  }

  return filters;
}

function getStoryCollection(db) {
  return db.collection(STORY_COLLECTION);
}

function getImageAssetCollection(db) {
  return db.collection(IMAGE_ASSET_COLLECTION);
}

function normalizeString(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function stripInlineHtml(value) {
  return sanitizeHtml(String(value || ""), {
    allowedTags: [],
    allowedAttributes: {},
  }).replace(/\s+/g, " ").trim();
}

function sanitizeInlineMarkup(value) {
  return sanitizeHtml(String(value || ""), INLINE_SANITIZE_OPTIONS)
    .replace(/&nbsp;/g, " ")
    .trim();
}

function normalizeBlockType(value) {
  return BLOCK_TYPES.has(value) ? value : "paragraph";
}

function normalizeImageWidth(value) {
  return IMAGE_WIDTHS.has(value) ? value : "body";
}

function createEmptyParagraphBlock() {
  return [{ type: "paragraph", html: "" }];
}

function plainTextToBlocks(content) {
  const trimmed = normalizeString(content);

  if (!trimmed) {
    return createEmptyParagraphBlock();
  }

  return trimmed
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => ({
      type: "paragraph",
      html: escapeHtml(chunk).replace(/\n/g, "<br>"),
    }));
}

function normalizeRawBodyBlocks(blocks, fallbackContent = "") {
  const sourceBlocks = Array.isArray(blocks)
    ? blocks
    : plainTextToBlocks(fallbackContent);
  const normalized = sourceBlocks
    .map((block) => {
      const type = normalizeBlockType(block?.type);

      if (type === "image") {
        return {
          type: "image",
          imageId: block?.imageId ? String(block.imageId) : null,
          uploadKey: normalizeString(block?.uploadKey),
          caption: normalizeString(block?.caption),
          alt: normalizeString(block?.alt),
          width: normalizeImageWidth(block?.width),
        };
      }

      const rawHtml =
        typeof block?.html === "string"
          ? block.html
          : typeof block?.text === "string"
            ? escapeHtml(block.text).replace(/\n/g, "<br>")
            : "";

      return {
        type,
        html: sanitizeInlineMarkup(rawHtml),
      };
    })
    .filter((block) => {
      if (block.type === "image") {
        return Boolean(block.imageId || block.uploadKey);
      }

      return Boolean(block.html || block.type !== "paragraph");
    });

  return normalized.length > 0 ? normalized : createEmptyParagraphBlock();
}

function parseBodyBlocksInput(bodyBlocks, fallbackContent = "") {
  if (Array.isArray(bodyBlocks)) {
    return normalizeRawBodyBlocks(bodyBlocks, fallbackContent);
  }

  if (typeof bodyBlocks === "string" && bodyBlocks.trim()) {
    try {
      const parsed = JSON.parse(bodyBlocks);
      return normalizeRawBodyBlocks(parsed, fallbackContent);
    } catch {
      return normalizeRawBodyBlocks(null, fallbackContent);
    }
  }

  return normalizeRawBodyBlocks(null, fallbackContent);
}

function buildPlainTextContentFromBlocks(blocks) {
  return blocks
    .map((block) =>
      block.type === "image" ? "" : stripInlineHtml(block.html),
    )
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function buildExcerpt(excerpt, content) {
  const cleanedExcerpt = normalizeString(excerpt);

  if (cleanedExcerpt) {
    return cleanedExcerpt;
  }

  const body = normalizeString(content).replace(/\s+/g, " ");

  if (!body) {
    return "";
  }

  return body.slice(0, 180);
}

function slugify(value) {
  const base = normalizeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return base || "untitled-story";
}

async function buildUniqueSlug(collection, title, currentStoryId = null) {
  const baseSlug = slugify(title);
  let candidate = baseSlug;
  let suffix = 2;

  while (true) {
    const existing = await collection.findOne({
      slug: candidate,
      ...(currentStoryId ? { _id: { $ne: currentStoryId } } : {}),
    });

    if (!existing) {
      return candidate;
    }

    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
}

function parseStatus(value) {
  if (value === "published" || value === "scheduled") {
    return value;
  }

  return "draft";
}

function parseScheduledFor(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new ApiError(400, "Scheduled publish date is invalid.");
  }

  return date;
}

function isStoryPublic(story, now = new Date()) {
  if (story?.status === "published") {
    return true;
  }

  if (
    story?.status === "scheduled" &&
    story?.scheduled_for &&
    new Date(story.scheduled_for).getTime() <= now.getTime()
  ) {
    return true;
  }

  return false;
}

function getEffectivePublicationStatus(story, now = new Date()) {
  if (isStoryPublic(story, now)) {
    return "published";
  }

  if (story?.status === "scheduled") {
    return "scheduled";
  }

  return "draft";
}

function buildPublicStoryQuery(now = new Date()) {
  return {
    $or: [
      { status: "published" },
      { status: "scheduled", scheduled_for: { $lte: now } },
    ],
  };
}

function countWords(content) {
  const words = normalizeString(content).split(/\s+/).filter(Boolean);
  return words.length;
}

function estimateReadingTimeMinutes(wordCount) {
  if (!wordCount) {
    return 0;
  }

  return Math.max(1, Math.ceil(wordCount / 200));
}

function ensureAuthoringInput({ title, content, excerpt, status, hasFiles }) {
  const hasText = Boolean(
    normalizeString(title) ||
      normalizeString(content) ||
      normalizeString(excerpt),
  );

  if (!hasText && !hasFiles) {
    throw new ApiError(400, "Add a title, content, or image before saving.");
  }

  if (status === "published") {
    if (!normalizeString(title)) {
      throw new ApiError(400, "A title is required before publishing.");
    }

    if (!normalizeString(content)) {
      throw new ApiError(400, "Story content is required before publishing.");
    }
  }
}

function ensurePublicationSettings({ status, scheduledFor }) {
  if (status === "scheduled") {
    if (!scheduledFor) {
      throw new ApiError(400, "Choose a schedule date before scheduling.");
    }

    if (scheduledFor.getTime() <= Date.now()) {
      throw new ApiError(400, "Scheduled publish date must be in the future.");
    }
  }
}

function validateIncomingImageFile(file) {
  if (!file) {
    return;
  }

  if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
    throw new ApiError(
      400,
      "Only JPG, PNG, WEBP, AVIF, and GIF images are supported.",
    );
  }
}

function normalizeFiles(files = {}) {
  const coverImage = Array.isArray(files.coverImage) ? files.coverImage[0] : null;
  const inlineImages = Array.isArray(files.inlineImages) ? files.inlineImages : [];

  if (inlineImages.length + (coverImage ? 1 : 0) > MAX_IMAGE_COUNT) {
    throw new ApiError(400, `A maximum of ${MAX_IMAGE_COUNT} images is allowed.`);
  }

  validateIncomingImageFile(coverImage);
  inlineImages.forEach(validateIncomingImageFile);

  return {
    coverImage,
    inlineImages,
  };
}

function sanitizePathSegment(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function sanitizeFilenamePart(value) {
  const parsed = path.parse(String(value || ""));
  const name = parsed.name || "image";

  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "image";
}

function normalizeFileExtension(filename) {
  const extension = path.extname(String(filename || "")).toLowerCase();

  if (/^\.[a-z0-9]+$/.test(extension)) {
    return extension;
  }

  return "";
}

function buildImageObjectName({
  scholarId,
  profileId,
  storyId,
  assetId,
  kind,
  filename,
  uploadedAt,
}) {
  const year = String(uploadedAt.getUTCFullYear());
  const month = String(uploadedAt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(uploadedAt.getUTCDate()).padStart(2, "0");
  const safeFilename = sanitizeFilenamePart(filename);
  const extension = normalizeFileExtension(filename);

  return [
    "scholars",
    sanitizePathSegment(scholarId),
    "profiles",
    sanitizePathSegment(profileId),
    "stories",
    String(storyId),
    kind,
    year,
    month,
    day,
    `${String(assetId)}-${safeFilename}${extension}`,
  ].join("/");
}

function buildAssetObjectCustomMetadata({
  scholarId,
  profileId,
  storyId,
  storySlug,
  kind,
  uploadKey,
  uploadedAt,
  uploadedBy,
}) {
  return {
    domain: "editorial_story",
    scholar_id: String(scholarId || ""),
    profile_id: String(profileId || ""),
    story_id: String(storyId || ""),
    story_slug: String(storySlug || ""),
    image_kind: String(kind || ""),
    upload_key: String(uploadKey || ""),
    uploaded_by: String(uploadedBy || ""),
    uploaded_at: uploadedAt.toISOString(),
  };
}

async function uploadBufferToCloudStorage({
  scholarId,
  profileId,
  storyId,
  storySlug,
  kind,
  uploadKey = null,
  file,
  user,
}) {
  validateIncomingImageFile(file);

  const bucket = getEditorialImagesBucket();
  const assetId = new ObjectId();
  const uploadedAt = new Date();
  const objectName = buildImageObjectName({
    scholarId,
    profileId,
    storyId,
    assetId,
    kind,
    filename: file.originalname,
    uploadedAt,
  });
  const uploadedBy = user?.login_email || scholarId;
  const cloudFile = bucket.file(objectName);

  await cloudFile.save(file.buffer, {
    resumable: false,
    validation: "crc32c",
    contentType: file.mimetype,
    metadata: {
      contentType: file.mimetype,
      cacheControl: "private, max-age=31536000, immutable",
      metadata: buildAssetObjectCustomMetadata({
        scholarId,
        profileId,
        storyId,
        storySlug,
        kind,
        uploadKey,
        uploadedAt,
        uploadedBy,
      }),
    },
  });

  const [metadata] = await cloudFile.getMetadata();
  const assetDocument = {
    _id: assetId,
    storage_provider: "gcs",
    bucket_name: env.gcpEditorialImagesBucket,
    object_name: objectName,
    storage_uri: `gs://${env.gcpEditorialImagesBucket}/${objectName}`,
    object_generation: metadata.generation || null,
    object_metageneration: metadata.metageneration || null,
    object_etag: metadata.etag || null,
    object_md5_hash: metadata.md5Hash || null,
    object_crc32c: metadata.crc32c || null,
    cache_control: metadata.cacheControl || null,
    scholar_id: scholarId,
    profile_id: profileId,
    story_id: storyId,
    story_slug: storySlug || null,
    story_status: "draft",
    story_effective_status: "draft",
    usage_scope: "editorial_story",
    inline_upload_key: uploadKey,
    kind,
    filename: file.originalname,
    content_type: metadata.contentType || file.mimetype,
    size_bytes: Number(metadata.size || file.size || 0),
    status: "active",
    uploaded_at: uploadedAt,
    last_attached_at: uploadedAt,
    createdAt: uploadedAt,
    updatedAt: uploadedAt,
    deleted_at: null,
    created_by: uploadedBy,
    updated_by: uploadedBy,
  };

  return {
    assetDocument,
    storyImage: {
      file_id: assetId,
      filename: file.originalname,
      content_type: metadata.contentType || file.mimetype,
      size_bytes: Number(metadata.size || file.size || 0),
      kind,
      uploaded_at: uploadedAt,
      storage_provider: "gcs",
      bucket_name: env.gcpEditorialImagesBucket,
      object_name: objectName,
      object_generation: metadata.generation || null,
    },
  };
}

async function deleteStorageObject(asset) {
  if (!asset?.bucket_name || !asset?.object_name) {
    return;
  }

  const bucket = getEditorialImagesBucket();

  if (bucket.name !== asset.bucket_name) {
    throw new ApiError(500, "Editorial image bucket configuration mismatch.");
  }

  await bucket.file(asset.object_name).delete({ ignoreNotFound: true });
}

function parseOrderedKeys(input) {
  if (!input) {
    return [];
  }

  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

async function uploadStoryImages({
  scholarId,
  profileId,
  storyId,
  storySlug,
  user,
  files,
  inlineImageKeys = [],
}) {
  const uploadedImages = [];
  const uploadedAssetDocuments = [];
  const uploadedInlineByKey = new Map();

  if (files.inlineImages.length !== inlineImageKeys.length) {
    throw new ApiError(400, "Inline image block mapping is invalid.");
  }

  for (const uploadKey of inlineImageKeys) {
    if (!uploadKey) {
      throw new ApiError(400, "Inline image block mapping is incomplete.");
    }
  }

  try {
    if (files.coverImage) {
      const cover = await uploadBufferToCloudStorage({
        scholarId,
        profileId,
        storyId,
        storySlug,
        kind: "cover",
        file: files.coverImage,
        user,
      });
      uploadedImages.push(cover.storyImage);
      uploadedAssetDocuments.push(cover.assetDocument);
    }

    for (let index = 0; index < files.inlineImages.length; index += 1) {
      const image = files.inlineImages[index];
      const uploadKey = inlineImageKeys[index];
      const uploaded = await uploadBufferToCloudStorage({
        scholarId,
        profileId,
        storyId,
        storySlug,
        kind: "inline",
        uploadKey,
        file: image,
        user,
      });
      uploadedImages.push(uploaded.storyImage);
      uploadedAssetDocuments.push(uploaded.assetDocument);
      uploadedInlineByKey.set(uploadKey, uploaded.storyImage);
    }
  } catch (error) {
    await Promise.allSettled(
      uploadedAssetDocuments.map((asset) => deleteStorageObject(asset)),
    );
    throw error;
  }

  return {
    uploadedImages,
    uploadedAssetDocuments,
    uploadedInlineByKey,
  };
}

function buildImageUrl(fileId) {
  return `/api/editorial-stories/images/${fileId}`;
}

function resolveBodyBlocksWithImages({
  rawBlocks,
  existingImages = [],
  uploadedInlineByKey = new Map(),
}) {
  const imageById = new Map(
    existingImages.map((image) => [String(image.file_id), image]),
  );
  const resolvedBlocks = [];
  const referencedImageIds = new Set();

  for (const block of rawBlocks) {
    if (block.type !== "image") {
      resolvedBlocks.push({
        type: block.type,
        html: block.html,
      });
      continue;
    }

    const existingImage =
      block.imageId && imageById.has(String(block.imageId))
        ? imageById.get(String(block.imageId))
        : null;
    const uploadedImage = block.uploadKey
      ? uploadedInlineByKey.get(block.uploadKey)
      : null;
    const image = uploadedImage || existingImage;

    if (!image) {
      continue;
    }

    referencedImageIds.add(String(image.file_id));
    resolvedBlocks.push({
      type: "image",
      image_file_id: image.file_id,
      caption: block.caption,
      alt_text: block.alt,
      width: block.width,
    });
  }

  return {
    bodyBlocks: resolvedBlocks.length > 0 ? resolvedBlocks : createEmptyParagraphBlock(),
    referencedImageIds,
  };
}

function mapStoryDocument(story) {
  const now = new Date();
  const images = Array.isArray(story.images) ? story.images : [];
  const coverImage = images.find((image) => image.kind === "cover") || null;
  const imageById = new Map(images.map((image) => [String(image.file_id), image]));
  const title = story.title || "Untitled story";
  const rawBlocks = Array.isArray(story.body_blocks) ? story.body_blocks : [];
  const bodyBlocks =
    rawBlocks.length > 0
      ? rawBlocks
          .map((block) => {
            if (block.type === "image") {
              const image = imageById.get(String(block.image_file_id));

              if (!image) {
                return null;
              }

              return {
                type: "image",
                imageId: String(image.file_id),
                url: buildImageUrl(image.file_id),
                filename: image.filename,
                caption: block.caption || "",
                alt: block.alt_text || "",
                width: normalizeImageWidth(block.width),
              };
            }

            return {
              type: normalizeBlockType(block.type),
              html: typeof block.html === "string" ? block.html : "",
            };
          })
          .filter(Boolean)
      : normalizeRawBodyBlocks(null, story.content || "");
  const plainTextContent = buildPlainTextContentFromBlocks(bodyBlocks);
  const wordCount = countWords(plainTextContent);

  return {
    id: story._id,
    title,
    subtitle: story.subtitle || "",
    excerpt: buildExcerpt(story.excerpt, plainTextContent),
    content: plainTextContent,
    bodyBlocks,
    status: story.status || "draft",
    effectiveStatus: getEffectivePublicationStatus(story, now),
    slug: story.slug || slugify(title),
    createdAt: story.createdAt || null,
    updatedAt: story.updatedAt || null,
    publishedAt: story.published_at || null,
    scheduledFor: story.scheduled_for || null,
    unpublishedAt: story.unpublished_at || null,
    publicUrl:
      story.slug && isStoryPublic(story, now) ? `/stories/${story.slug}` : null,
    wordCount,
    readingTimeMinutes: estimateReadingTimeMinutes(wordCount),
    coverImage: coverImage
      ? {
          id: coverImage.file_id,
          url: buildImageUrl(coverImage.file_id),
          filename: coverImage.filename,
          contentType: coverImage.content_type,
        }
      : null,
  };
}

function parseRetainedIds(input) {
  if (input === undefined || input === null) {
    return null;
  }

  if (Array.isArray(input)) {
    return input.flatMap(parseRetainedIds);
  }

  if (typeof input !== "string") {
    return [];
  }

  const trimmed = input.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return null;
    }
  }

  return trimmed
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

async function findOwnedStory({ storyId, scholarId, profileId }) {
  if (!ObjectId.isValid(storyId)) {
    throw new ApiError(404, "Story not found.");
  }

  const db = await getDb();
  const story = await getStoryCollection(db).findOne({
    _id: new ObjectId(storyId),
    $or: buildScholarStoryFilters({ scholarId, profileId }),
  });

  if (!story) {
    throw new ApiError(404, "Story not found.");
  }

  return story;
}

function buildStoryStatusQuery(status) {
  if (!status || status === "all") {
    return {};
  }

  if (status === "draft") {
    return { status: "draft" };
  }

  if (status === "scheduled") {
    return {
      status: "scheduled",
      scheduled_for: { $gt: new Date() },
    };
  }

  if (status === "published") {
    return buildPublicStoryQuery();
  }

  throw new ApiError(400, "Unsupported story status filter.");
}

function mapStorySummary(story) {
  const mapped = mapStoryDocument(story);

  return {
    id: mapped.id,
    title: mapped.title,
    subtitle: mapped.subtitle,
    excerpt: mapped.excerpt,
    status: mapped.status,
    effectiveStatus: mapped.effectiveStatus,
    slug: mapped.slug,
    createdAt: mapped.createdAt,
    updatedAt: mapped.updatedAt,
    publishedAt: mapped.publishedAt,
    scheduledFor: mapped.scheduledFor,
    publicUrl: mapped.publicUrl,
    wordCount: mapped.wordCount,
    readingTimeMinutes: mapped.readingTimeMinutes,
    coverImage: mapped.coverImage,
  };
}

function toObjectIds(values = []) {
  return values
    .map((value) => (ObjectId.isValid(String(value)) ? new ObjectId(String(value)) : null))
    .filter(Boolean);
}

async function insertAssetDocuments(assetCollection, assetDocuments) {
  if (!assetDocuments.length) {
    return;
  }

  await assetCollection.insertMany(assetDocuments, { ordered: true });
}

async function rollbackUploadedAssets({ assetCollection, assetDocuments }) {
  if (!assetDocuments.length) {
    return;
  }

  await Promise.allSettled(
    assetDocuments.map((asset) => deleteStorageObject(asset)),
  );

  await assetCollection.deleteMany({
    _id: { $in: assetDocuments.map((asset) => asset._id) },
  });
}

async function syncAssetDocuments({
  assetCollection,
  imageIds,
  storyId,
  storySlug,
  status,
  effectiveStatus,
  updatedBy,
}) {
  const objectIds = toObjectIds(imageIds);

  if (!objectIds.length) {
    return;
  }

  const now = new Date();

  await assetCollection.updateMany(
    {
      _id: { $in: objectIds },
      status: "active",
    },
    {
      $set: {
        story_id: storyId,
        story_slug: storySlug || null,
        story_status: status,
        story_effective_status: effectiveStatus,
        last_attached_at: now,
        updated_by: updatedBy,
        updatedAt: now,
      },
    },
  );
}

async function fetchAssetDocumentsByImageIds(assetCollection, imageIds) {
  const objectIds = toObjectIds(imageIds);

  if (!objectIds.length) {
    return [];
  }

  return assetCollection
    .find({
      _id: { $in: objectIds },
      status: "active",
    })
    .toArray();
}

async function markAssetDocumentsDeleted({
  assetCollection,
  assets,
  updatedBy,
}) {
  if (!assets.length) {
    return;
  }

  const now = new Date();

  for (const asset of assets) {
    await deleteStorageObject(asset);
  }

  await assetCollection.updateMany(
    {
      _id: { $in: assets.map((asset) => asset._id) },
    },
    {
      $set: {
        status: "deleted",
        deleted_at: now,
        updated_by: updatedBy,
        updatedAt: now,
      },
    },
  );
}

function resolvePublishedAt({
  currentStory = null,
  status,
  scheduledFor = null,
  now,
}) {
  if (status === "published") {
    return currentStory?.status === "published" && currentStory?.published_at
      ? currentStory.published_at
      : now;
  }

  if (status === "scheduled") {
    return scheduledFor;
  }

  return null;
}

async function listEditorialStories({ scholarId, profileId, status = "all" }) {
  const db = await getDb();
  const stories = await getStoryCollection(db)
    .find({
      $or: buildScholarStoryFilters({ scholarId, profileId }),
      ...buildStoryStatusQuery(status),
    })
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(50)
    .toArray();

  return serializeMongoValue({
    stories: stories.map(mapStorySummary),
  });
}

async function getEditorialStory({ storyId, scholarId, profileId }) {
  const story = await findOwnedStory({ storyId, scholarId, profileId });

  return serializeMongoValue({
    story: mapStoryDocument(story),
  });
}

async function getPublishedStoryBySlug(slug) {
  const db = await getDb();
  const story = await getStoryCollection(db).findOne({
    slug,
    ...buildPublicStoryQuery(),
  });

  if (!story) {
    throw new ApiError(404, "Published story not found.");
  }

  return serializeMongoValue({
    story: mapStoryDocument(story),
  });
}

async function createEditorialStory({ scholarId, profileId, user, body, files }) {
  const db = await getDb();
  const collection = getStoryCollection(db);
  const assetCollection = getImageAssetCollection(db);
  const storyId = new ObjectId();
  const normalizedFiles = normalizeFiles(files);
  const title = normalizeString(body.title);
  const subtitle = normalizeString(body.subtitle);
  const status = parseStatus(body.status);
  const scheduledFor = parseScheduledFor(body.scheduledFor);
  const slug = await buildUniqueSlug(collection, title || "Untitled story");
  const rawBlocks = parseBodyBlocksInput(body.bodyBlocks, body.content || "");
  const inlineImageKeys = parseOrderedKeys(body.inlineImageKeys);
  const now = new Date();
  let uploadedImages = [];
  let uploadedAssetDocuments = [];
  let story;
  let storyInserted = false;
  try {
    const uploadResult = await uploadStoryImages({
      scholarId,
      profileId,
      storyId,
      storySlug: slug,
      user,
      files: normalizedFiles,
      inlineImageKeys,
    });
    uploadedImages = uploadResult.uploadedImages;
    uploadedAssetDocuments = uploadResult.uploadedAssetDocuments;
    const { bodyBlocks, referencedImageIds } = resolveBodyBlocksWithImages({
      rawBlocks,
      existingImages: [],
      uploadedInlineByKey: uploadResult.uploadedInlineByKey,
    });
    const plainTextContent = buildPlainTextContentFromBlocks(bodyBlocks);
    const excerpt = buildExcerpt(body.excerpt, plainTextContent);
    const hasFiles = Boolean(
      normalizedFiles.coverImage || normalizedFiles.inlineImages.length,
    );

    ensureAuthoringInput({
      title,
      content: plainTextContent,
      excerpt,
      status,
      hasFiles,
    });
    ensurePublicationSettings({
      status,
      scheduledFor,
    });

    const retainedImageIds = new Set(referencedImageIds);
    const persistedImages = uploadedImages.filter((image) => {
      if (image.kind === "cover") {
        return true;
      }

      return retainedImageIds.has(String(image.file_id));
    });
    story = {
      _id: storyId,
      scholar_id: scholarId,
      profile_id: profileId,
      authorId: scholarId,
      login_email: user?.login_email || null,
      title: title || "Untitled story",
      subtitle,
      excerpt,
      content: plainTextContent,
      body_blocks: bodyBlocks,
      slug,
      status,
      images: persistedImages,
      created_by: user?.login_email || scholarId,
      updated_by: user?.login_email || scholarId,
      createdAt: now,
      updatedAt: now,
      published_at: resolvePublishedAt({
        status,
        scheduledFor,
        now,
      }),
      scheduled_for: status === "scheduled" ? scheduledFor : null,
      unpublished_at: null,
      source: "native_dashboard_editor",
      editor_version: 4,
    };

    await insertAssetDocuments(assetCollection, uploadedAssetDocuments);
    await collection.insertOne(story);
    storyInserted = true;
  } catch (error) {
    if (!storyInserted) {
      await rollbackUploadedAssets({
        assetCollection,
        assetDocuments: uploadedAssetDocuments,
      });
    }
    throw error;
  }

  try {
    await syncAssetDocuments({
      assetCollection,
      imageIds: story.images.map((image) => image.file_id),
      storyId,
      storySlug: slug,
      status,
      effectiveStatus: getEffectivePublicationStatus(story, now),
      updatedBy: user?.login_email || scholarId,
    });
  } catch (error) {
    console.error("Failed to sync editorial image metadata after create:", error);
  }

  const created = await collection.findOne({ _id: storyId });

  return serializeMongoValue({
    story: mapStoryDocument(created),
  });
}

async function updateEditorialStory({
  storyId,
  scholarId,
  profileId,
  user,
  body,
  files,
}) {
  const db = await getDb();
  const collection = getStoryCollection(db);
  const assetCollection = getImageAssetCollection(db);
  const existingStory = await findOwnedStory({ storyId, scholarId, profileId });
  const normalizedFiles = normalizeFiles(files);
  const existingImages = Array.isArray(existingStory.images) ? existingStory.images : [];
  const title = normalizeString(body.title || existingStory.title);
  const subtitle =
    body.subtitle !== undefined ? normalizeString(body.subtitle) : existingStory.subtitle || "";
  const status = parseStatus(body.status || existingStory.status);
  const scheduledFor =
    body.scheduledFor !== undefined
      ? parseScheduledFor(body.scheduledFor)
      : existingStory.scheduled_for || null;
  const nextSlug = await buildUniqueSlug(
    collection,
    title || "Untitled story",
    existingStory._id,
  );
  const rawBlocks =
    body.bodyBlocks !== undefined || body.content !== undefined
      ? parseBodyBlocksInput(body.bodyBlocks, body.content || "")
      : parseBodyBlocksInput(existingStory.body_blocks, existingStory.content || "");
  const inlineImageKeys = parseOrderedKeys(body.inlineImageKeys);
  const now = new Date();
  let uploadedAssetDocuments = [];
  let storyUpdated = false;
  let nextStory = null;
  let removedImages = [];
  try {
    const uploadResult = await uploadStoryImages({
      scholarId,
      profileId,
      storyId: existingStory._id,
      storySlug: nextSlug,
      user,
      files: normalizedFiles,
      inlineImageKeys,
    });
    const uploadedImages = uploadResult.uploadedImages;
    uploadedAssetDocuments = uploadResult.uploadedAssetDocuments;
    const { bodyBlocks, referencedImageIds } = resolveBodyBlocksWithImages({
      rawBlocks,
      existingImages,
      uploadedInlineByKey: uploadResult.uploadedInlineByKey,
    });
    const plainTextContent = buildPlainTextContentFromBlocks(bodyBlocks);
    const excerpt = buildExcerpt(
      body.excerpt !== undefined ? body.excerpt : existingStory.excerpt,
      plainTextContent,
    );
    const hasFiles = Boolean(
      normalizedFiles.coverImage ||
        normalizedFiles.inlineImages.length ||
        existingImages.length > 0,
    );

    ensureAuthoringInput({
      title,
      content: plainTextContent,
      excerpt,
      status,
      hasFiles,
    });
    ensurePublicationSettings({
      status,
      scheduledFor: status === "scheduled" ? scheduledFor : null,
    });

    const retainedIdValues = parseRetainedIds(body.retainImageIds);
    const retainedIds = new Set(retainedIdValues || []);
    const nextImageIds = new Set(referencedImageIds);
    const nextImages = [];
    removedImages = [];
    const incomingCover =
      uploadedImages.find((image) => image.kind === "cover") || null;
    const uploadedInlineImages = uploadedImages.filter(
      (image) => image.kind === "inline",
    );

    for (const image of existingImages) {
      const imageId = String(image.file_id);

      if (image.kind === "cover") {
        if (incomingCover) {
          removedImages.push(image);
          continue;
        }

        if (retainedIds.has(imageId)) {
          nextImages.push(image);
        } else {
          removedImages.push(image);
        }

        continue;
      }

      if (nextImageIds.has(imageId)) {
        nextImages.push(image);
      } else {
        removedImages.push(image);
      }
    }

    if (incomingCover) {
      nextImages.push(incomingCover);
    }

    nextImages.push(...uploadedInlineImages);

    nextStory = {
      ...existingStory,
      title: title || "Untitled story",
      subtitle,
      excerpt,
      content: plainTextContent,
      body_blocks: bodyBlocks,
      status,
      slug: nextSlug,
      images: nextImages,
      updated_by: user?.login_email || scholarId,
      updatedAt: now,
      published_at: resolvePublishedAt({
        currentStory: existingStory,
        status,
        scheduledFor,
        now,
      }),
      scheduled_for: status === "scheduled" ? scheduledFor : null,
      unpublished_at:
        status === "draft" &&
        (existingStory.status === "published" ||
          existingStory.status === "scheduled")
          ? now
          : null,
      editor_version: 4,
    };

    await insertAssetDocuments(assetCollection, uploadedAssetDocuments);
    await collection.updateOne(
      { _id: existingStory._id },
      {
        $set: {
          title: nextStory.title,
          subtitle: nextStory.subtitle,
          excerpt: nextStory.excerpt,
          content: nextStory.content,
          body_blocks: nextStory.body_blocks,
          status: nextStory.status,
          slug: nextStory.slug,
          images: nextStory.images,
          updated_by: nextStory.updated_by,
          updatedAt: nextStory.updatedAt,
          published_at: nextStory.published_at,
          scheduled_for: nextStory.scheduled_for,
          unpublished_at: nextStory.unpublished_at,
          editor_version: nextStory.editor_version,
        },
      },
    );
    storyUpdated = true;
  } catch (error) {
    if (!storyUpdated) {
      await rollbackUploadedAssets({
        assetCollection,
        assetDocuments: uploadedAssetDocuments,
      });
    }
    throw error;
  }

  try {
    await syncAssetDocuments({
      assetCollection,
      imageIds: nextStory.images.map((image) => image.file_id),
      storyId: existingStory._id,
      storySlug: nextSlug,
      status,
      effectiveStatus: getEffectivePublicationStatus(nextStory, now),
      updatedBy: user?.login_email || scholarId,
    });
  } catch (error) {
    console.error("Failed to sync editorial image metadata after update:", error);
  }

  try {
    const removedAssetDocuments = await fetchAssetDocumentsByImageIds(
      assetCollection,
      removedImages.map((image) => image.file_id),
    );
    await markAssetDocumentsDeleted({
      assetCollection,
      assets: removedAssetDocuments,
      updatedBy: user?.login_email || scholarId,
    });
  } catch (error) {
    console.error("Failed to delete removed editorial images:", error);
  }

  const updated = await collection.findOne({ _id: existingStory._id });

  return serializeMongoValue({
    story: mapStoryDocument(updated),
  });
}

async function findAccessibleAssetOrThrow({ fileId, scholarId, profileId, isPublic }) {
  if (!ObjectId.isValid(fileId)) {
    throw new ApiError(404, "Image not found.");
  }

  const db = await getDb();
  const assetCollection = getImageAssetCollection(db);
  const storyCollection = getStoryCollection(db);
  const objectId = new ObjectId(fileId);
  const storyQuery = isPublic
    ? {
        ...buildPublicStoryQuery(),
        "images.file_id": objectId,
      }
    : {
        $or: buildScholarStoryFilters({ scholarId, profileId }),
        "images.file_id": objectId,
      };
  const story = await storyCollection.findOne(storyQuery);

  if (!story) {
    throw new ApiError(404, "Image not found.");
  }

  const asset = await assetCollection.findOne({
    _id: objectId,
    status: "active",
  });

  if (!asset) {
    throw new ApiError(404, "Image not found.");
  }

  return asset;
}

async function streamAssetToResponse({ asset, cacheControl, res }) {
  const bucket = getEditorialImagesBucket();

  if (bucket.name !== asset.bucket_name) {
    throw new ApiError(500, "Editorial image bucket configuration mismatch.");
  }

  res.setHeader("Content-Type", asset.content_type || "application/octet-stream");
  res.setHeader("Cache-Control", cacheControl);

  await new Promise((resolve, reject) => {
    const stream = bucket.file(asset.object_name).createReadStream();
    stream.on("error", (error) => {
      if (error?.code === 404) {
        reject(new ApiError(404, "Image not found."));
        return;
      }

      reject(error);
    });
    stream.on("end", resolve);
    stream.pipe(res);
  });
}

async function streamEditorialImage({ fileId, scholarId, profileId, res }) {
  const asset = await findAccessibleAssetOrThrow({
    fileId,
    scholarId,
    profileId,
    isPublic: false,
  });

  await streamAssetToResponse({
    asset,
    cacheControl: "private, max-age=60",
    res,
  });
}

async function streamPublishedEditorialImage({ fileId, res }) {
  const asset = await findAccessibleAssetOrThrow({
    fileId,
    isPublic: true,
  });

  await streamAssetToResponse({
    asset,
    cacheControl: "public, max-age=300",
    res,
  });
}

module.exports = {
  createEditorialStory,
  getEditorialStory,
  getPublishedStoryBySlug,
  listEditorialStories,
  streamEditorialImage,
  streamPublishedEditorialImage,
  updateEditorialStory,
};
