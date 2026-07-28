"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  FaArrowLeft,
  FaArrowUpRightFromSquare,
  FaGear,
  FaPlus,
} from "react-icons/fa6";

import RichTextBlockEditor, {
  createInitialBlocks,
  getPlainTextFromBlocks,
} from "@/components/editorial/RichTextBlockEditor";
import StoryPreview from "@/components/editorial/StoryPreview";

const AUTH_API_URL =
  process.env.NEXT_PUBLIC_AUTH_API_URL || "http://localhost:4000";

function toDateTimeLocalValue(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

function storyToForm(story) {
  const bodyBlocks = createInitialBlocks(
    story?.bodyBlocks || [],
    story?.id ? `story-${story.id}` : "draft",
  );
  const retainedImageIds = [];

  if (story?.coverImage?.id) {
    retainedImageIds.push(story.coverImage.id);
  }

  for (const block of bodyBlocks) {
    if (block.type === "image" && block.imageId) {
      retainedImageIds.push(block.imageId);
    }
  }

  return {
    id: story?.id || null,
    title: story?.title || "",
    subtitle: story?.subtitle || "",
    excerpt: story?.excerpt || "",
    bodyBlocks,
    status: story?.status || "draft",
    effectiveStatus: story?.effectiveStatus || story?.status || "draft",
    publicUrl: story?.publicUrl || null,
    scheduledFor: toDateTimeLocalValue(story?.scheduledFor),
    coverImageId: story?.coverImage?.id || null,
    coverImageUrl: story?.coverImage?.url
      ? `${AUTH_API_URL}${story.coverImage.url}`
      : "",
    coverImageFilename: story?.coverImage?.filename || "",
    coverFile: null,
    coverPreviewUrl: "",
    retainedImageIds,
    updatedAt: story?.updatedAt || null,
  };
}

function createEmptyForm() {
  return storyToForm(null);
}

async function readError(response) {
  try {
    const data = await response.json();
    return data?.error || "Request failed.";
  } catch {
    return "Request failed.";
  }
}

function collectInlineImagePayload(bodyBlocks) {
  const inlineImages = [];
  const inlineImageKeys = [];
  const serializedBlocks = [];
  const retainedInlineImageIds = [];

  for (const block of bodyBlocks) {
    if (block.type !== "image") {
      serializedBlocks.push({
        type: block.type,
        html: block.html || "",
      });
      continue;
    }

    if (block.file && block.uploadKey) {
      inlineImages.push(block.file);
      inlineImageKeys.push(block.uploadKey);
      serializedBlocks.push({
        type: "image",
        uploadKey: block.uploadKey,
        caption: block.caption || "",
        alt: block.alt || "",
        width: block.width || "body",
      });
      continue;
    }

    if (block.imageId) {
      retainedInlineImageIds.push(block.imageId);
      serializedBlocks.push({
        type: "image",
        imageId: block.imageId,
        caption: block.caption || "",
        alt: block.alt || "",
        width: block.width || "body",
      });
    }
  }

  return {
    serializedBlocks,
    inlineImages,
    inlineImageKeys,
    retainedInlineImageIds,
  };
}

function formatDate(value) {
  if (!value) {
    return "Not saved yet";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not saved yet";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export default function StoryWorkspace({ initialStory = null }) {
  const router = useRouter();
  const [form, setForm] = useState(() =>
    initialStory ? storyToForm(initialStory) : createEmptyForm(),
  );
  const [activeBlockId, setActiveBlockId] = useState(() =>
    initialStory?.id ? `story-${initialStory.id}-0` : "draft-0",
  );
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [mode, setMode] = useState("write"); // "write" | "preview"

  const plainTextContent = useMemo(
    () => getPlainTextFromBlocks(form.bodyBlocks),
    [form.bodyBlocks],
  );

  const totalWords = useMemo(() => {
    return plainTextContent.split(/\s+/).filter(Boolean).length;
  }, [plainTextContent]);

  const readingTime = Math.max(1, Math.ceil(totalWords / 200 || 1));

  function releasePreviewUrl() {
    if (form.coverPreviewUrl) {
      URL.revokeObjectURL(form.coverPreviewUrl);
    }

    for (const block of form.bodyBlocks) {
      if (block.type === "image" && block.previewUrl) {
        URL.revokeObjectURL(block.previewUrl);
      }
    }
  }

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function updateBodyBlocks(bodyBlocks) {
    setForm((current) => ({
      ...current,
      bodyBlocks,
    }));
  }

  function handleCoverFileChange(event) {
    const file = event.target.files?.[0] || null;

    setForm((current) => {
      if (current.coverPreviewUrl) {
        URL.revokeObjectURL(current.coverPreviewUrl);
      }

      return {
        ...current,
        coverImageId: null,
        coverImageUrl: "",
        coverImageFilename: file?.name || "",
        coverFile: file,
        coverPreviewUrl: file ? URL.createObjectURL(file) : "",
        retainedImageIds: current.retainedImageIds.filter(
          (id) => id !== current.coverImageId,
        ),
      };
    });
  }

  function clearCoverSelection() {
    setForm((current) => {
      if (current.coverPreviewUrl) {
        URL.revokeObjectURL(current.coverPreviewUrl);
      }

      return {
        ...current,
        coverImageId: null,
        coverImageUrl: "",
        coverImageFilename: "",
        coverFile: null,
        coverPreviewUrl: "",
        retainedImageIds: current.retainedImageIds.filter(
          (id) => id !== current.coverImageId,
        ),
      };
    });
  }

  async function submitStory(nextStatus) {
    setError("");
    setFeedback("");
    setIsSaving(true);

    const {
      serializedBlocks,
      inlineImages,
      inlineImageKeys,
      retainedInlineImageIds,
    } = collectInlineImagePayload(form.bodyBlocks);
    const retainedIds = [
      ...(form.coverImageId ? [form.coverImageId] : []),
      ...retainedInlineImageIds,
    ];

    const payload = new FormData();
    payload.set("title", form.title);
    payload.set("subtitle", form.subtitle);
    payload.set("excerpt", form.excerpt);
    payload.set("content", plainTextContent);
    payload.set("bodyBlocks", JSON.stringify(serializedBlocks));
    payload.set("inlineImageKeys", JSON.stringify(inlineImageKeys));
    payload.set("status", nextStatus);
    payload.set("scheduledFor", nextStatus === "scheduled" ? form.scheduledFor : "");
    payload.set("retainImageIds", JSON.stringify(retainedIds));

    if (form.coverFile) {
      payload.append("coverImage", form.coverFile);
    }

    for (const image of inlineImages) {
      payload.append("inlineImages", image);
    }

    const endpoint = form.id
      ? `${AUTH_API_URL}/api/editorial-stories/${form.id}`
      : `${AUTH_API_URL}/api/editorial-stories`;
    const method = form.id ? "PATCH" : "POST";

    try {
      const response = await fetch(endpoint, {
        method,
        body: payload,
        credentials: "include",
      });

      if (!response.ok) {
        setError(await readError(response));
        return;
      }

      const result = await response.json();
      const savedStory = result?.story;

      if (!savedStory) {
        setError("Story save failed.");
        return;
      }

      releasePreviewUrl();
      const nextForm = storyToForm(savedStory);
      setForm(nextForm);
      setActiveBlockId(nextForm.bodyBlocks[0]?.id || null);
      setFeedback(
        nextStatus === "published"
          ? "Story published successfully."
          : "Draft saved successfully.",
      );

      if (!form.id) {
        router.replace(`/editorial/${savedStory.id}`);
      } else {
        router.refresh();
      }
    } finally {
      setIsSaving(false);
    }
  }

  const effectiveCoverImageUrl = form.coverPreviewUrl || form.coverImageUrl;
  const hasCover = Boolean(effectiveCoverImageUrl);

  return (
    <div className={`sc-writer mode-${mode}`}>
      {/* Slim editor bar — sticks under the app top bar */}
      <div className="sc-write-bar">
        <div className="sc-write-bar-left">
          <Link href="/editorial" className="sc-write-back">
            <FaArrowLeft size={12} aria-hidden /> Stories
          </Link>
          <span className="sc-write-status">
            {form.id ? `Editing ${form.status}` : "New draft"}
          </span>
          <span className="sc-write-metatext">
            {totalWords} {totalWords === 1 ? "word" : "words"} &middot; {readingTime} min &middot;{" "}
            {formatDate(form.updatedAt)}
          </span>
        </div>
        <div className="sc-write-bar-right">
          <button
            type="button"
            className="sc-write-ghost"
            onClick={() => setMode(mode === "write" ? "preview" : "write")}
          >
            {mode === "write" ? "Preview" : "Keep writing"}
          </button>
          <button
            type="button"
            className="sc-write-secondary"
            onClick={() => submitStory("draft")}
            disabled={isSaving}
          >
            {isSaving ? "Saving…" : "Save draft"}
          </button>
          <button
            type="button"
            className="sc-write-publish"
            onClick={() => submitStory("published")}
            disabled={isSaving}
          >
            Publish
          </button>
        </div>
      </div>

      {error ? <p className="sc-write-msg is-error">{error}</p> : null}
      {feedback ? <p className="sc-write-msg is-ok">{feedback}</p> : null}

      {mode === "write" ? (
        <div className="sc-write-canvas">
          {hasCover ? (
            <div className="sc-write-cover">
              <img src={effectiveCoverImageUrl} alt={form.coverImageFilename || "Cover"} />
              <div className="sc-write-cover-actions">
                <label className="sc-write-cover-btn">
                  Replace
                  <input type="file" accept="image/*" onChange={handleCoverFileChange} hidden />
                </label>
                <button
                  type="button"
                  className="sc-write-cover-btn is-remove"
                  onClick={clearCoverSelection}
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <label className="sc-write-addcover">
              <FaPlus size={13} aria-hidden /> Add a cover image
              <input type="file" accept="image/*" onChange={handleCoverFileChange} hidden />
            </label>
          )}

          <input
            type="text"
            className="sc-write-title"
            placeholder="Title"
            value={form.title}
            onChange={(event) => updateField("title", event.target.value)}
          />
          <input
            type="text"
            className="sc-write-subtitle"
            placeholder="Add a subtitle…"
            value={form.subtitle}
            onChange={(event) => updateField("subtitle", event.target.value)}
          />

          <div className="sc-write-body">
            <RichTextBlockEditor
              blocks={form.bodyBlocks}
              onChange={updateBodyBlocks}
              activeBlockId={activeBlockId}
              onActiveBlockChange={setActiveBlockId}
            />
          </div>

          <details className="sc-write-settings">
            <summary>
              <FaGear size={13} aria-hidden /> Story settings &amp; scheduling
            </summary>
            <div className="sc-write-settings-body">
              <label className="sc-write-field">
                <span>Summary / deck</span>
                <textarea
                  className="sc-write-input"
                  rows={2}
                  placeholder="A short summary shown in the feed and previews"
                  value={form.excerpt}
                  onChange={(event) => updateField("excerpt", event.target.value)}
                />
              </label>
              <label className="sc-write-field">
                <span>Schedule publish time</span>
                <input
                  type="datetime-local"
                  className="sc-write-input"
                  value={form.scheduledFor}
                  onChange={(event) => updateField("scheduledFor", event.target.value)}
                />
              </label>
              <div className="sc-write-settings-actions">
                <button
                  type="button"
                  className="sc-write-secondary"
                  onClick={() => submitStory("scheduled")}
                  disabled={isSaving}
                >
                  Schedule
                </button>
                {form.id && form.status !== "draft" ? (
                  <button
                    type="button"
                    className="sc-write-secondary"
                    onClick={() => submitStory("draft")}
                    disabled={isSaving}
                  >
                    Unpublish
                  </button>
                ) : null}
                {form.publicUrl ? (
                  <a
                    href={form.publicUrl}
                    className="sc-write-link"
                    target="_blank"
                    rel="noreferrer"
                  >
                    View live story <FaArrowUpRightFromSquare size={11} aria-hidden />
                  </a>
                ) : null}
              </div>
            </div>
          </details>
        </div>
      ) : (
        <div className="sc-write-previewpane">
          <div className="sc-write-preview-tag">Draft preview &middot; reader view</div>
          <StoryPreview
            title={form.title}
            subtitle={form.subtitle}
            excerpt={form.excerpt}
            coverImageUrl={effectiveCoverImageUrl}
            coverImageFilename={form.coverImageFilename}
            bodyBlocks={form.bodyBlocks.map((block) =>
              block.type === "image"
                ? { ...block, url: block.previewUrl || block.imageUrl }
                : block,
            )}
          />
        </div>
      )}
    </div>
  );
}
