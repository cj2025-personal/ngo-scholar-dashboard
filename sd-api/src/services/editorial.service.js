const path = require("path");

const { ObjectId } = require("mongodb");
const sanitizeHtml = require("sanitize-html");

const { env } = require("../config/env");
const { COLLECTIONS, getDb } = require("../db/mongo");
const { ApiError } = require("../lib/api-error");
const { getEditorialImagesBucket } = require("../lib/gcs");
const { serializeMongoValue } = require("../lib/serialize");
const { ownedByScholarFilter } = require("../lib/identity");
const { buildByline } = require("../lib/byline");
const { humanPublisher, makesPublic } = require("../lib/actor");
const storyVersion = require("../lib/storyVersion");
const levelsLib = require("../lib/levels");
const recordLib = require("../lib/record");
const ledger = require("../lib/evidenceLedger");
const { AUDIENCES: AUDIENCE_TABLE } = require("../lib/audiences");
const { readsForStories } = require("./reads.service");
const {
  normalizeBlockProvenance,
  presentBlockProvenance,
  storyProvenanceFromJob,
  provenanceLine,
  normalizeBlockContext,
  presentBlockContext,
} = require("../lib/provenance");

const STORY_COLLECTION = COLLECTIONS.scholarEditorials;
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
  /* One writer, one shape, one indexed equality.
     The six-way $or this replaces existed because the collection was shared
     with a service that keyed rows to `authorId` in the `users` namespace.
     Nothing writes that shape here, so matching on it could only ever return
     another service's rows. */
  /* A deleted story is gone from every owner-facing read; only the row remains. */
  return [{ ...ownedByScholarFilter(profileId), status: { $ne: "deleted" } }];
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
      const html = sanitizeInlineMarkup(rawHtml);

      /* Provenance rides on drafted text blocks and nowhere else. Measured
         here against the html being saved, so the stored chip state is the
         server's verdict, not the client's. */
      const provenance = normalizeBlockProvenance({
        sourceRefs: block?.sourceRefs,
        draftedText: block?.draftedText,
        fidelity: block?.fidelity,
        extension: block?.extension,
        reach: block?.reach,
        recheckedAt: block?.recheckedAt,
        currentHtml: html,
      });

      /* A block the scholar asked the agent to write as their own view carries
         no citation on purpose, and says so, so the reader's chip can say
         "author" rather than nothing. */
      const ownView = Boolean(block?.ownView) && !provenance;
      /* The author's own context rides with an own-view block: the judge's
         verdict and the specifics to verify, with the author's ticks. */
      const context = ownView ? normalizeBlockContext(block?.context) : null;
      return { type, html, ...(provenance ? { provenance } : {}), ...(ownView ? { own_view: true, ...(context ? { context } : {}) } : {}) };
    })
    .filter((block) => {
      if (block.type === "image") {
        return Boolean(block.imageId || block.uploadKey);
      }

      return Boolean(block.html || block.type !== "paragraph");
    });

  return normalized.length > 0 ? normalized : createEmptyParagraphBlock();
}

/** Stored blocks, in the shape a client sends, provenance included. */
function storedBlocksToInput(blocks) {
  return (Array.isArray(blocks) ? blocks : []).map((b) =>
    b.type === "image"
      ? { type: "image", imageId: b.image_file_id ? String(b.image_file_id) : null, caption: b.caption || "", alt: b.alt_text || "", width: b.width }
      : { type: b.type, html: typeof b.html === "string" ? b.html : "", ...presentBlockProvenance(b.provenance), ...(b.own_view ? { ownView: true, ...(b.context ? { context: presentBlockContext(b.context) } : {}) } : {}) },
  );
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

/**
 * Nothing the agent brought in from outside the paper reaches a reader
 * without the author's eyes on it. A story with an unverified specific in
 * the author's own context is not published or scheduled, whatever else is
 * in order; the sentence names what is waiting.
 */
function ensureContextVerified({ bodyBlocks, status }) {
  if (status !== "published" && status !== "scheduled") return;
  const pending = [];
  for (const b of Array.isArray(bodyBlocks) ? bodyBlocks : []) {
    if (!b?.own_view || !b.context) continue;
    for (const v of Array.isArray(b.context.to_verify) ? b.context.to_verify : []) {
      if (v && v.text && v.verified !== true) pending.push(v.text);
    }
  }
  if (!pending.length) return;
  throw new ApiError(
    400,
    `${pending.length} specific${pending.length === 1 ? "" : "s"} in your own context ${pending.length === 1 ? "is" : "are"} not yet verified: ` +
      `${pending.slice(0, 5).join(", ")}${pending.length > 5 ? ", …" : ""}. Tick each in Checks once you have checked it, or cut it, before publishing.`,
  );
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

/**
 * The person making a story public, or a refusal.
 *
 * A draft may be saved by whatever the session admits; a draft reaches no
 * reader. The moment a story is published or scheduled, the actor must be a
 * person with a scholar login — see `lib/actor.js` for the counter-example
 * this exists to prevent — and their identity is written to `published_by`.
 */
function resolvePublisher({ status, user, currentStory = null }) {
  if (!makesPublic(status)) {
    return null;
  }
  const verdict = humanPublisher(user);
  if (!verdict.ok) {
    throw new ApiError(403, `Only a signed-in scholar can publish: ${verdict.reason}.`);
  }
  /* Already public and staying so: the original publisher stands. */
  if (currentStory && makesPublic(currentStory.status) && currentStory.published_by) {
    return currentStory.published_by;
  }
  return verdict.actor;
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
        ...(block.provenance ? { provenance: block.provenance } : {}),
        ...(block.own_view ? { own_view: true, ...(block.context ? { context: block.context } : {}) } : {}),
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

/**
 * The author of a story, from the curated record.
 *
 * Read-only against `scholars`, which is owned by the curation pipeline — the
 * byline is a view of that record, never a copy, so a scholar who changes
 * institution does not have to re-publish old work to stop it misstating where
 * they are.
 *
 * A story whose `profile_id` resolves to nothing returns null rather than a
 * guess. That should be impossible here (this service is the only writer and
 * always sets it), so it is logged: a published article with no resolvable
 * author is a defect worth seeing, not a case to paper over.
 */
async function resolveStoryAuthor(db, profileId) {
  if (!profileId) return null;

  const scholar = await db
    .collection("scholars")
    .findOne(
      { profile_id: profileId },
      { projection: { profile_id: 1, name: 1, "about.current_position": 1, "about.institution": 1, "about.avatar_initial": 1 } },
    );

  if (!scholar) {
    console.warn(
      `[byline] published story references profile_id ${profileId}, which matches no scholar record`,
    );
    return null;
  }

  return buildByline(scholar);
}

/**
 * The source a story was drafted from, looked up now rather than copied then.
 *
 * Same principle as the byline: the story holds the source's id, and the
 * title, year and URL are read from the source record at read time, so a
 * corrected title or a withdrawn licence shows without republishing. An
 * unresolvable source yields no line at all — a "drawn from" claim that
 * cannot name what it was drawn from is not one worth printing.
 */
async function resolveStoryProvenance(db, provenance) {
  if (!provenance || !provenance.source_id) return null;
  const base = {
    origin: provenance.origin,
    sourceId: provenance.source_id,
    audience: provenance.audience || null,
    /* Whose account it is. The levels service and the agent read it to keep
       editing in the voice the draft was written in. */
    voice: provenance.voice || null,
    draftedAt: provenance.drafted_at || null,
    promptVersion: provenance.prompt_version || null,
  };

  try {
    if (provenance.origin === "contributed") {
      const doc = await db
        .collection("scholar_documents")
        .findOne({ document_id: provenance.source_id }, { projection: { title: 1, document_type: 1, status: 1 } });
      if (!doc) return { ...base, title: null, year: null, url: null, line: null };
      const title = doc.title || provenance.source_title || null;
      return { ...base, title, year: provenance.source_year ?? null, url: null, line: provenanceLine({ title, year: provenance.source_year }) };
    }
    const src = await db
      .collection("source_texts")
      .findOne({ source_id: provenance.source_id }, { projection: { title: 1, source_url: 1, resolved_url: 1, allowed_use: 1, license_type: 1 } });
    if (!src) return { ...base, title: null, year: null, url: null, line: null };
    const title = src.title || provenance.source_title || null;
    return {
      ...base,
      title,
      year: provenance.source_year ?? null,
      url: src.resolved_url || src.source_url || null,
      licence: src.license_type || null,
      line: provenanceLine({ title, year: provenance.source_year }),
    };
  } catch (error) {
    console.warn("[provenance] could not resolve story source:", error.message);
    return { ...base, title: provenance.source_title || null, year: provenance.source_year ?? null, url: null, line: null };
  }
}

/**
 * A draft job's provenance, claimed for a story being saved.
 *
 * Verifies the job is the scholar's and holds a draft, then returns the
 * story-level provenance to store. The job itself is told which story took
 * its draft after the save succeeds (see `linkDraftJob`).
 */
async function claimDraftProvenance(db, { draftJobId, profileId }) {
  if (!draftJobId) return null;
  if (!ObjectId.isValid(String(draftJobId))) throw new ApiError(400, "Draft job id is invalid.");
  const job = await db
    .collection(COLLECTIONS.draftJobs)
    .findOne({ _id: new ObjectId(String(draftJobId)), profile_id: profileId }, { projection: { source: 1, status: 1, prompt_version: 1, graph_version: 1, finished_at: 1, created_at: 1 } });
  if (!job) throw new ApiError(404, "Draft job not found.");
  if (job.status !== "awaiting_review" && job.status !== "published") {
    throw new ApiError(409, "That draft is not ready to be saved into a story.");
  }
  return storyProvenanceFromJob(job);
}

async function linkDraftJob({ draftJobId, profileId, storyId }) {
  if (!draftJobId) return;
  try {
    /* Lazy: draftJob.service requires drafting.service, and neither requires
       this file, so the require cannot loop — but keeping it here keeps the
       editorial service loadable in tests that stub nothing. */
    const { resumeJob } = require("./draftJob.service");
    await resumeJob({ jobId: String(draftJobId), profileId, action: "publish", storyId: String(storyId) });
  } catch (error) {
    /* Already linked on an earlier save is the common case; anything else is
       logged. A failure to annotate the job must never fail the scholar's save. */
    if (!(error instanceof ApiError && error.statusCode === 409)) {
      console.warn("[provenance] could not link draft job to story:", error.message);
    }
  }
}

/** Stored blocks in the shape a client reads: images resolved, provenance presented. */
function presentStoredBlocks(rawBlocks, imageById) {
  return rawBlocks
    .map((block) => {
      if (block.type === "image") {
        const image = imageById.get(String(block.image_file_id));
        if (!image) return null;
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
        ...presentBlockProvenance(block.provenance),
        ...(block.own_view ? { ownView: true, ...(block.context ? { context: presentBlockContext(block.context) } : {}) } : {}),
      };
    })
    .filter(Boolean);
}

function mapStoryDocument(story, author = null, provenance = null) {
  const now = new Date();
  const images = Array.isArray(story.images) ? story.images : [];
  const coverImage = images.find((image) => image.kind === "cover") || null;
  const imageById = new Map(images.map((image) => [String(image.file_id), image]));
  const title = story.title || "Untitled story";
  const rawBlocks = Array.isArray(story.body_blocks) ? story.body_blocks : [];
  const bodyBlocks =
    rawBlocks.length > 0
      ? presentStoredBlocks(rawBlocks, imageById)
      : normalizeRawBodyBlocks(null, story.content || "");

  /* The article for other readers. Each level lines up with bodyBlocks. A
     level is stale once the article changed under it; the public read drops
     stale and unapproved levels, the owner sees them with the reason. */
  const levelRows = story.levels && typeof story.levels === "object" ? Object.values(story.levels) : [];
  const levels = levelRows
    .filter((l) => l && l.audience && AUDIENCE_TABLE[l.audience])
    .map((l) => {
      const st = levelsLib.staleness(l, bodyBlocks);
      return {
        audience: l.audience,
        label: AUDIENCE_TABLE[l.audience].label,
        grade: AUDIENCE_TABLE[l.audience].grade,
        approved: Boolean(l.approved),
        approvedAt: l.approved_at || null,
        approvedBy: l.approved_by || null,
        generatedAt: l.generated_at || null,
        readability: l.readability || null,
        fidelity: l.fidelity || null,
        /* What the level was checked against: the paper, or — for an article
           written by hand, which has none — the scholar's own paragraphs.
           Presented because every surface reporting fidelity has to be able to
           say which, and they are not the same claim. Levels written before
           this was recorded carry no value and are read as "source". */
        grounding: l.grounding || "source",
        /* Paragraphs that go beyond the paper, judged for reach; null on a level written before there were any. */
        reach: l.reach || null,
        stale: st.stale,
        staleReason: st.reason,
        warnings: Array.isArray(l.warnings) ? l.warnings : [],
        blocks: presentStoredBlocks(Array.isArray(l.blocks) ? l.blocks : [], imageById),
      };
    })
    .sort((a, b) => a.grade - b.grade);
  const plainTextContent = buildPlainTextContentFromBlocks(bodyBlocks);
  const wordCount = countWords(plainTextContent);

  return {
    id: story._id,
    title,
    /* Null where it could not be resolved. The reader renders nothing rather
       than "Unknown Author", which on a piece of scholarship reads as our
       mistake rather than as missing data. */
    author,
    /* The source the draft was drawn from, resolved at read time like the
       byline. Null for a story written by hand. */
    provenance,
    /* What the drafter said about its own draft, for the Checks rail. */
    draftWarnings: Array.isArray(story.draft_warnings) ? story.draft_warnings : [],
    draftChecks: story.draft_checks || null,
    subtitle: story.subtitle || "",
    excerpt: buildExcerpt(story.excerpt, plainTextContent),
    content: plainTextContent,
    bodyBlocks,
    status: story.status || "draft",
    effectiveStatus: getEffectivePublicationStatus(story, now),
    /* What a save must be made against. The editor sends it back. */
    version: storyVersion.versionOf(story),
    levels,
    /* What the scientific record says about the source, as last checked.
       A retraction is shown to the reader too; it is not ours to keep. */
    record: story.record
      ? {
          doi: story.record.doi || null,
          checkedAt: story.record.checked_at || null,
          alerts: Array.isArray(story.record.alerts) ? story.record.alerts.map((a) => ({ kind: a.kind, type: a.type, noticeDoi: a.notice_doi || null, noticeUrl: a.notice_url || null, date: a.date || null, sentence: a.sentence, affectedBlocks: a.affected_blocks || [] })) : [],
          headline: recordLib.headline(story.record.alerts || []),
          acknowledgedAt: story.record.acknowledged_at || null,
          reason: story.record.reason || null,
        }
      : null,
    /* The stored evidence ledger, summarised. Null until the story is public. */
    evidence: story.evidence?.manifest
      ? {
          signed: Boolean(story.evidence.signed),
          keyId: story.evidence.key_id || null,
          generatedAt: story.evidence.generated_at || null,
          version: story.evidence.manifest.story?.version ?? null,
          stale: (story.evidence.manifest.story?.version ?? null) !== storyVersion.versionOf(story),
          totals: story.evidence.manifest.totals || null,
          /* One sentence, written once, so the footer under the article and
             the verify page cannot drift apart in what they claim. */
          summary: ledger.readerSentence(story.evidence.manifest.totals),
        }
      : null,
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

/**
 * Ownership and status, composed so neither can erase the other.
 *
 * Named and exported because this is where the leak lived: both halves are
 * `$or` objects, and combining them with a spread kept only the second. A
 * scholar asking for their published stories got everyone's.
 */
function buildStoryListQuery({ scholarId, profileId, status = "all" }) {
  return {
    $and: [
      { $or: buildScholarStoryFilters({ scholarId, profileId }) },
      buildStoryStatusQuery(status),
    ],
  };
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
    provenance: story.provenance ? { sourceId: story.provenance.source_id || null, title: story.provenance.source_title || null } : null,
    /* Enough for a to-do line, not the whole picture. */
    record: mapped.record ? { headline: mapped.record.headline, acknowledgedAt: mapped.record.acknowledgedAt, alerts: mapped.record.alerts.length } : null,
    levels: { written: mapped.levels.length, waiting: mapped.levels.filter((l) => !l.approved && !l.stale).length, stale: mapped.levels.filter((l) => l.stale).length },
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

/**
 * Delete a story: a soft delete that takes it out of every read, public
 * included, and releases its images. The row stays so a draft job that
 * points at it keeps pointing somewhere. Only the owner can delete; the
 * agent never calls this.
 */
/**
 * Append one version of a story to its history.
 *
 * Consecutive saves by the same person, close together, rewrite the last row
 * rather than adding one, so an hour of autosaved typing reads as save points
 * instead of hundreds of near-identical entries. An agent's version never
 * collapses into a person's, because "who changed this" has to stay
 * answerable. Version 1 is never pruned: it is the draft as the machine wrote
 * it, and it is the one a scholar is most likely to want back.
 */
async function appendRevision(db, { storyId, profileId, story, version, source, actor, note, turnId, jobId, at }) {
  const revisions = db.collection(COLLECTIONS.storyRevisions);
  const doc = storyVersion.revisionDocument({ storyId, profileId, story, version, source, actor, note, turnId, jobId, at });
  const last = await revisions.findOne({ story_id: storyId }, { sort: { version: -1 } });

  if (storyVersion.shouldCoalesce({ last, source, actor, turnId, note, at })) {
    const { created_at: _keepOriginalTime, ...rest } = doc;
    await revisions.updateOne({ _id: last._id }, { $set: { ...rest, coalesced_at: at } });
    return;
  }

  await revisions.insertOne(doc);
  const extra = await revisions
    .find({ story_id: storyId, version: { $ne: 1 } }, { projection: { _id: 1 }, sort: { version: -1 }, skip: storyVersion.KEEP_REVISIONS })
    .toArray();
  if (extra.length) await revisions.deleteMany({ _id: { $in: extra.map((d) => d._id) } });
}

/**
 * After a write that leaves a story public, rebuild its evidence ledger.
 * Derived data: it never fails the write it follows, and never bumps the
 * version, so the editor's next save is not refused by our own bookkeeping.
 */
async function refreshEvidenceAfterWrite(db, storyId) {
  try {
    const { refreshStoryEvidence } = require("./evidence.service");
    await refreshStoryEvidence(db, storyId);
  } catch (error) {
    console.error("[ledger] could not refresh the evidence ledger:", error.message);
  }
}

/**
 * The one way this service changes a story's content.
 *
 * The write is conditional on the version the caller read. If the story moved
 * on in between — the agent's change landed, another tab saved — nothing is
 * written and the caller is told what happened, rather than quietly winning.
 * Every accepted write becomes a version in the history.
 *
 * @param {object} p
 * @param {object} p.story        the story as read, carrying its version
 * @param {object} p.set          fields to write
 * @param {string} p.source       storyVersion.SOURCE.*
 * @param {string} p.actor        who caused it
 * @param {number|null} p.baseVersion  the version the caller edited, or null for an unguarded write
 * @returns {Promise<{version: number, at: Date}>}
 */
async function commitStoryWrite(db, { story, set, source, actor, note = null, turnId = null, jobId = null, baseVersion = null }) {
  const collection = getStoryCollection(db);
  const at = new Date();
  const version = storyVersion.versionOf(story) + 1;

  const result = await collection.updateOne(
    storyVersion.guardFilter(story._id, baseVersion),
    { $set: { ...set, version, updatedAt: at } },
  );

  if (result.matchedCount === 0) {
    const current = await collection.findOne({ _id: story._id }, { projection: { version: 1, updated_by: 1 } });
    if (!current) throw new ApiError(404, "Story not found.");
    throw new ApiError(409, storyVersion.conflictSentence({
      current: storyVersion.versionOf(current),
      who: current.updated_by && current.updated_by !== actor ? "elsewhere" : null,
    }));
  }

  await appendRevision(db, {
    storyId: story._id, profileId: story.profile_id, story: { ...story, ...set },
    version, source, actor, note, turnId, jobId, at,
  });
  return { version, at };
}

/** The history panel's list: what changed, when, and by whom. Never whole bodies. */
async function listStoryRevisions({ storyId, scholarId, profileId, limit = 30 }) {
  const story = await findOwnedStory({ storyId, scholarId, profileId });
  const db = await getDb();
  const docs = await db
    .collection(COLLECTIONS.storyRevisions)
    .find({ story_id: story._id }, { sort: { version: -1 }, limit: Math.min(Number(limit) || 30, 100) })
    .toArray();
  return serializeMongoValue({
    version: storyVersion.versionOf(story),
    revisions: docs.map(storyVersion.viewRevision),
  });
}

/**
 * Put an earlier version back, as a new version.
 *
 * History is never rewritten: restoring version 3 onto version 9 produces
 * version 10 whose content is version 3's, so the restore itself can be undone.
 * Pictures that have since been released are dropped rather than restored as
 * broken references, and the scholar is told how many.
 */
async function restoreStoryRevision({ storyId, version, scholarId, profileId, user, baseVersion = null }) {
  const story = await findOwnedStory({ storyId, scholarId, profileId });
  const db = await getDb();
  const wanted = Number(version);
  if (!storyVersion.isVersion(wanted)) throw new ApiError(400, "That is not a version number.");
  const revision = await db.collection(COLLECTIONS.storyRevisions).findOne({ story_id: story._id, version: wanted });
  if (!revision) throw new ApiError(404, "That version is no longer kept.");

  const liveImageIds = new Set((Array.isArray(story.images) ? story.images : []).map((img) => String(img.file_id)));
  const blocks = (revision.body_blocks || []).filter((b) => b.type !== "image" || liveImageIds.has(String(b.image_id || b.imageId)));
  const dropped = (revision.body_blocks || []).length - blocks.length;

  const content = buildPlainTextContentFromBlocks(blocks);
  const { version: newVersion } = await commitStoryWrite(db, {
    story,
    set: {
      title: revision.title || story.title,
      subtitle: revision.subtitle || "",
      excerpt: revision.excerpt || "",
      content,
      body_blocks: blocks,
      levels: revision.levels && typeof revision.levels === "object" ? revision.levels : {},
      updated_by: user?.login_email || scholarId,
      editor_version: 4,
    },
    source: storyVersion.SOURCE.RESTORE,
    actor: user?.login_email || scholarId,
    note: `Restored version ${wanted}`,
    baseVersion,
  });
  await refreshEvidenceAfterWrite(db, story._id);

  const updated = await getStoryCollection(db).findOne({ _id: story._id });
  const [author, provenance] = await Promise.all([
    resolveStoryAuthor(db, updated.profile_id),
    resolveStoryProvenance(db, updated.provenance),
  ]);
  return serializeMongoValue({
    story: mapStoryDocument(updated, author, provenance),
    restoredFrom: wanted,
    version: newVersion,
    imagesDropped: dropped,
  });
}

async function deleteEditorialStory({ storyId, scholarId, profileId, user }) {
  const story = await findOwnedStory({ storyId, scholarId, profileId });
  const db = await getDb();
  const collection = getStoryCollection(db);
  const assetCollection = getImageAssetCollection(db);
  const now = new Date();
  const deletedBy = user?.login_email || scholarId;

  await collection.updateOne(
    { _id: story._id },
    { $set: { status: "deleted", deleted_at: now, deleted_by: deletedBy, updated_by: deletedBy, updatedAt: now, previous_status: story.status } },
  );

  try {
    const images = Array.isArray(story.images) ? story.images : [];
    const assets = await fetchAssetDocumentsByImageIds(assetCollection, images.map((image) => image.file_id));
    await markAssetDocumentsDeleted({ assetCollection, assets, updatedBy: deletedBy });
  } catch (error) {
    console.error("Failed to release images of a deleted story:", error);
  }

  return { ok: true, storyId: String(story._id), previousStatus: story.status };
}

async function listEditorialStories({ scholarId, profileId, status = "all" }) {
  const db = await getDb();
  /* `$and`, not a spread.
     Ownership is expressed as `$or`, and so is the `published` status filter -
     `buildPublicStoryQuery` matches published-or-scheduled-and-due. Spreading
     the second object over the first replaced the ownership `$or` with the
     status one and the query lost its owner clause entirely, so
     `?status=published` returned every scholar's published stories to whoever
     asked. `draft` and `scheduled` were unaffected only because they happen to
     use plain `status` keys, which is luck, not design. Composing with `$and`
     keeps both clauses whatever shape either takes. */
  const stories = await getStoryCollection(db)
    .find(buildStoryListQuery({ scholarId, profileId, status }))
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(50)
    .toArray();

  /* What came of the work, carried on the same read as the work itself. Only
     a published story can have been read, so only those are asked about. */
  const publishedIds = stories
    .filter((story) => story.status === "published" || story.status === "scheduled")
    .map((story) => story._id);
  const reads = await readsForStories(db, publishedIds);

  return serializeMongoValue({
    stories: stories.map((story) => {
      const summary = mapStorySummary(story);
      /* `null`, not `{total: 0}`, for a story that was never published: "no
         reads yet" and "cannot have been read" are different things and the
         dashboard says them differently. */
      summary.reads = publishedIds.some((id) => id.equals(story._id))
        ? reads.get(String(story._id)) || { total: 0, recent: 0 }
        : null;
      return summary;
    }),
  });
}

async function getEditorialStory({ storyId, scholarId, profileId }) {
  const story = await findOwnedStory({ storyId, scholarId, profileId });
  const db = await getDb();

  /* The same byline a reader will see. Carried here so the editor can show a
     scholar how their work will be attributed before they publish it, rather
     than after. */
  const [author, provenance] = await Promise.all([
    resolveStoryAuthor(db, story.profile_id),
    resolveStoryProvenance(db, story.provenance),
  ]);
  return serializeMongoValue({
    story: mapStoryDocument(story, author, provenance),
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

  const [author, provenance] = await Promise.all([
    resolveStoryAuthor(db, story.profile_id),
    resolveStoryProvenance(db, story.provenance),
  ]);
  const mapped = mapStoryDocument(story, author, provenance);
  /* A reader may switch only between levels the scholar approved and that
     still say what the article says. */
  mapped.levels = mapped.levels.filter((l) => l.approved && !l.stale);
  return serializeMongoValue({ story: mapped });
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
    ensureContextVerified({ bodyBlocks, status });
    ensurePublicationSettings({
      status,
      scheduledFor,
    });
    const publishedBy = resolvePublisher({ status, user });
    const provenance = await claimDraftProvenance(db, { draftJobId: body.draftJobId, profileId });

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
      published_by: publishedBy,
      provenance,
      source: "native_dashboard_editor",
      editor_version: 4,
      version: 1,
    };

    await insertAssetDocuments(assetCollection, uploadedAssetDocuments);
    await collection.insertOne(story);
    storyInserted = true;
    await appendRevision(db, {
      storyId, profileId, story, version: 1,
      /* When the words came from a draft job, the machine wrote this version
         and the scholar's save only placed it in the page: the history says
         so, as it does for a draft the job made into a story itself. The
         scholar's first change is version 2, under their own name. */
      source: provenance ? storyVersion.SOURCE.DRAFTER : storyVersion.SOURCE.SCHOLAR,
      actor: provenance ? `drafter:${provenance.graph_version || provenance.graphVersion || "draft-graph"}` : story.created_by,
      note: provenance ? "The draft as the machine wrote it, placed in your page" : "First version",
      turnId: null, jobId: body.draftJobId || null, at: now,
    });
    await linkDraftJob({ draftJobId: body.draftJobId, profileId, storyId });
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
  /* A save that sends no body, such as publishing or changing the subtitle,
     keeps the body it has. The stored blocks carry provenance in the stored
     shape, so they are put back into the shape a client sends before they
     are parsed again; parsing them as stored silently stripped every chip. */
  const rawBlocks =
    body.bodyBlocks !== undefined || body.content !== undefined
      ? parseBodyBlocksInput(body.bodyBlocks, body.content || "")
      : parseBodyBlocksInput(storedBlocksToInput(existingStory.body_blocks), existingStory.content || "");
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
    ensureContextVerified({ bodyBlocks, status });
    ensurePublicationSettings({
      status,
      scheduledFor: status === "scheduled" ? scheduledFor : null,
    });
    const publishedBy = resolvePublisher({ status, user, currentStory: existingStory });
    /* A story keeps the provenance it has unless a new draft is being saved
       into it, in which case the newer job wins. */
    const claimed = await claimDraftProvenance(db, { draftJobId: body.draftJobId, profileId });
    const provenance = claimed || existingStory.provenance || null;

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
      published_by: publishedBy,
      provenance,
      editor_version: 4,
    };

    await insertAssetDocuments(assetCollection, uploadedAssetDocuments);
    await commitStoryWrite(db, {
      story: existingStory,
      set: {
        title: nextStory.title,
        subtitle: nextStory.subtitle,
        excerpt: nextStory.excerpt,
        content: nextStory.content,
        body_blocks: nextStory.body_blocks,
        status: nextStory.status,
        slug: nextStory.slug,
        images: nextStory.images,
        updated_by: nextStory.updated_by,
        published_at: nextStory.published_at,
        scheduled_for: nextStory.scheduled_for,
        unpublished_at: nextStory.unpublished_at,
        published_by: nextStory.published_by,
        provenance: nextStory.provenance,
        editor_version: nextStory.editor_version,
      },
      source: storyVersion.SOURCE.SCHOLAR,
      actor: nextStory.updated_by,
      baseVersion: storyVersion.parseBaseVersion(body.baseVersion),
    });
    storyUpdated = true;
    await refreshEvidenceAfterWrite(db, existingStory._id);
    await linkDraftJob({ draftJobId: body.draftJobId, profileId, storyId: existingStory._id });
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

/**
 * Apply a revision the scholar accepted from the story agent.
 *
 * Takes the agent's block list directly — no multipart, no upload keys —
 * and runs it through the same normalisation, provenance measurement and
 * image bookkeeping as a save from the composer, so a story revised by
 * instruction is indistinguishable in the database from one edited by hand.
 * Images the agent generated were uploaded when the proposal was made; they
 * arrive here as `newImages` and become part of the story only now.
 */
async function applyStoryRevision({ storyId, scholarId, profileId, user, fields = {}, blocks, newImages = [], baseVersion = null, turnId = null, note = null }) {
  const db = await getDb();
  const collection = getStoryCollection(db);
  const assetCollection = getImageAssetCollection(db);
  const existingStory = await findOwnedStory({ storyId, scholarId, profileId });
  const existingImages = [...(Array.isArray(existingStory.images) ? existingStory.images : []), ...newImages];

  const rawBlocks = normalizeRawBodyBlocks(
    (blocks || []).map((b) =>
      b.type === "image"
        ? { type: "image", imageId: b.imageId, caption: b.caption || "", alt: b.alt || "", width: b.width || "body" }
        : {
            type: b.type, html: b.html,
            sourceRefs: b.sourceRefs,
            /* A block the agent wrote has no drafted text yet; its own text is
               the baseline the chip will measure the scholar's edits against. */
            draftedText: b.draftedText || (Array.isArray(b.sourceRefs) && b.sourceRefs.length ? stripInlineHtml(b.html) : ""),
            fidelity: b.fidelity, ownView: b.ownView, extension: b.extension, reach: b.reach, context: b.context,
          },
    ),
  );
  const { bodyBlocks, referencedImageIds } = resolveBodyBlocksWithImages({ rawBlocks, existingImages, uploadedInlineByKey: new Map() });
  const plainTextContent = buildPlainTextContentFromBlocks(bodyBlocks);
  const title = normalizeString(fields.title) || existingStory.title || "Untitled story";
  const subtitle = fields.subtitle !== undefined ? normalizeString(fields.subtitle) : existingStory.subtitle || "";
  const excerpt = buildExcerpt(fields.excerpt !== undefined ? fields.excerpt : existingStory.excerpt, plainTextContent);
  const now = new Date();
  const updatedBy = user?.login_email || scholarId;

  const nextImages = existingImages.filter((img) => img.kind === "cover" || referencedImageIds.has(String(img.file_id)));
  const removedImages = existingImages.filter((img) => img.kind !== "cover" && !referencedImageIds.has(String(img.file_id)));

  await commitStoryWrite(db, {
    story: existingStory,
    set: { title, subtitle, excerpt, content: plainTextContent, body_blocks: bodyBlocks, images: nextImages, updated_by: updatedBy, editor_version: 4 },
    source: storyVersion.SOURCE.AGENT,
    actor: updatedBy,
    turnId: turnId || null,
    note: note || null,
    baseVersion,
  });
  await refreshEvidenceAfterWrite(db, existingStory._id);

  try {
    await syncAssetDocuments({
      assetCollection, imageIds: nextImages.map((image) => image.file_id), storyId: existingStory._id, storySlug: existingStory.slug,
      status: existingStory.status, effectiveStatus: getEffectivePublicationStatus({ ...existingStory, updatedAt: now }, now), updatedBy,
    });
    const removedAssets = await fetchAssetDocumentsByImageIds(assetCollection, removedImages.map((image) => image.file_id));
    await markAssetDocumentsDeleted({ assetCollection, assets: removedAssets, updatedBy });
  } catch (error) {
    console.error("Failed to sync editorial images after an agent revision:", error);
  }

  const updated = await collection.findOne({ _id: existingStory._id });
  const [author, provenance] = await Promise.all([resolveStoryAuthor(db, updated.profile_id), resolveStoryProvenance(db, updated.provenance)]);
  return serializeMongoValue({ story: mapStoryDocument(updated, author, provenance) });
}

/**
 * A draft story from a finished draft job, created by the worker.
 *
 * Status "draft", never anything else: this is the machine putting its
 * first draft where the scholar will find it, not a publication. The byline
 * still resolves from the curated record at read time; `published_by` stays
 * empty until a person publishes.
 */
async function createStoryFromDraft({ job, draft }) {
  const db = await getDb();
  const collection = getStoryCollection(db);
  const storyId = new ObjectId();
  const title = normalizeString(draft.title) || "Untitled draft";
  const slug = await buildUniqueSlug(collection, title);
  const rawBlocks = normalizeRawBodyBlocks(
    (draft.bodyBlocks || []).map((b) => ({
      type: b.type, html: b.html,
      sourceRefs: b.sourceRefs, fidelity: b.fidelity,
      /* A paragraph that goes beyond the paper keeps its kind and the reach judge's verdict. */
      extension: b.extension, reach: b.reach,
      /* The author's own context: theirs, with the list to verify. */
      ownView: b.ownView, context: b.context,
      draftedText: stripInlineHtml(b.html),
    })),
  );
  const { bodyBlocks } = resolveBodyBlocksWithImages({ rawBlocks, existingImages: [], uploadedInlineByKey: new Map() });
  const plainTextContent = buildPlainTextContentFromBlocks(bodyBlocks);
  const now = new Date();
  await collection.insertOne({
    _id: storyId,
    scholar_id: job.profile_id,
    profile_id: job.profile_id,
    authorId: job.profile_id,
    login_email: null,
    title,
    subtitle: normalizeString(draft.subtitle),
    excerpt: buildExcerpt(draft.excerpt, plainTextContent),
    content: plainTextContent,
    body_blocks: bodyBlocks,
    slug,
    status: "draft",
    images: [],
    created_by: `drafter:${job.graph_version || "draft-graph"}`,
    updated_by: `drafter:${job.graph_version || "draft-graph"}`,
    createdAt: now,
    updatedAt: now,
    published_at: null,
    scheduled_for: null,
    unpublished_at: null,
    published_by: null,
    provenance: storyProvenanceFromJob(job),
    draft_warnings: draft.warnings || [],
    draft_readability: draft.readability || null,
    draft_checks: draft.checks || null,
    source: "drafter",
    editor_version: 4,
    version: 1,
  });
  await appendRevision(db, {
    storyId,
    profileId: job.profile_id,
    story: { title, subtitle: normalizeString(draft.subtitle), excerpt: buildExcerpt(draft.excerpt, plainTextContent), content: plainTextContent, body_blocks: bodyBlocks, status: "draft" },
    version: 1,
    source: storyVersion.SOURCE.DRAFTER,
    actor: `drafter:${job.graph_version || "draft-graph"}`,
    note: "The draft as the machine wrote it",
    turnId: null,
    jobId: job._id || null,
    at: now,
  });
  return { storyId, slug };
}

module.exports = {
  /* Exported for the ownership-scope tests: the composition below is what
     leaked one scholar's stories to another. */
  buildScholarStoryFilters,
  buildStoryStatusQuery,
  buildStoryListQuery,
  applyStoryRevision,
  deleteEditorialStory,
  listStoryRevisions,
  restoreStoryRevision,
  commitStoryWrite,
  createStoryFromDraft,
  createEditorialStory,
  getEditorialStory,
  getPublishedStoryBySlug,
  listEditorialStories,
  streamEditorialImage,
  streamPublishedEditorialImage,
  updateEditorialStory,
  /* For the story agent, which uploads what it generates through the same
     path as the composer's inline images. */
  findOwnedStory,
  mapStoryDocument,
  normalizeRawBodyBlocks,
  refreshEvidenceAfterWrite,
  resolveStoryAuthor,
  resolveStoryProvenance,
  buildPublicStoryQuery,
  uploadBufferToCloudStorage,
  insertAssetDocuments,
  markAssetDocumentsDeleted,
  fetchAssetDocumentsByImageIds,
  streamAssetToResponse,
};
