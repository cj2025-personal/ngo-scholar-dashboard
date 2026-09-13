"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import DraftSourcesPanel from "@/components/editorial/DraftSourcesPanel";
import AgentPanel from "@/components/editorial/AgentPanel";
import SourceRail from "@/components/editorial/SourceRail";
import ChecksRail, { summariseBlocks } from "@/components/editorial/ChecksRail";
import PublishCheck from "@/components/editorial/PublishCheck";
import DeleteStoryButton from "@/components/editorial/DeleteStoryButton";
import HistoryRail from "@/components/editorial/HistoryRail";
import { createDraftJob, getStoryPassages, watchDraftJob } from "@/lib/drafting";
import { plainText, shortSourceLabel } from "@/lib/provenance";
import { assessForAudience } from "@/lib/readability";

const AUTH_API_URL =
  process.env.NEXT_PUBLIC_AUTH_API_URL || "http://localhost:4000";

function toDateTimeLocalValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

function storyToForm(story) {
  const bodyBlocks = createInitialBlocks(story?.bodyBlocks || [], story?.id ? `story-${story.id}` : "draft");
  const retainedImageIds = [];
  if (story?.coverImage?.id) retainedImageIds.push(story.coverImage.id);
  for (const block of bodyBlocks) if (block.type === "image" && block.imageId) retainedImageIds.push(block.imageId);
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
    coverImageUrl: story?.coverImage?.url ? `${AUTH_API_URL}${story.coverImage.url}` : "",
    coverImageFilename: story?.coverImage?.filename || "",
    coverFile: null,
    coverPreviewUrl: "",
    retainedImageIds,
    updatedAt: story?.updatedAt || null,
    /* What a save is made against. The server refuses a save made against an
       older version rather than letting it overwrite what landed since. */
    version: story?.version ?? 1,
    /* Resolved at read time by the API; null for a story written by hand. */
    provenance: story?.provenance || null,
    author: story?.author || null,
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
        ...(block.sourceRefs ? { sourceRefs: block.sourceRefs, draftedText: block.draftedText || "", fidelity: block.fidelity || null } : {}),
        ...(block.ownView ? { ownView: true } : {}),
      });
      continue;
    }
    if (block.file && block.uploadKey) {
      inlineImages.push(block.file);
      inlineImageKeys.push(block.uploadKey);
      serializedBlocks.push({ type: "image", uploadKey: block.uploadKey, caption: block.caption || "", alt: block.alt || "", width: block.width || "body" });
      continue;
    }
    if (block.imageId) {
      retainedInlineImageIds.push(block.imageId);
      serializedBlocks.push({ type: "image", imageId: block.imageId, caption: block.caption || "", alt: block.alt || "", width: block.width || "body" });
    }
  }
  return { serializedBlocks, inlineImages, inlineImageKeys, retainedInlineImageIds };
}

function formatDate(value) {
  if (!value) return "Not saved yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not saved yet";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

/** Sections for the outline rail: each subheading with the blocks under it. */
function sectionsOf(blocks) {
  const sections = [];
  let current = { id: "top", heading: "Opening", blockIds: [], attention: 0, edited: 0 };
  for (const b of blocks) {
    if (b.type === "subheading" || b.type === "heading") {
      if (current.blockIds.length || sections.length === 0) sections.push(current);
      current = { id: b.id, heading: plainText(b.html) || "Untitled section", blockIds: [b.id], attention: 0, edited: 0 };
      continue;
    }
    current.blockIds.push(b.id);
    if (b.fidelity && b.fidelity.verdict !== "supported" && Array.isArray(b.sourceRefs) && b.sourceRefs.length) current.attention += 1;
    if (b.traceable === false) current.edited += 1;
  }
  sections.push(current);
  return sections.filter((s, i) => !(i === 0 && s.id === "top" && s.blockIds.length === 0));
}

/**
 * The story workspace.
 *
 * One component, two shapes. A story written by hand gets the plain editor.
 * A story drafted from a paper gets the review workspace: the outline on the
 * left, the editor in the middle, and on the right the passage behind the
 * block you are on, the checks on the whole draft, and the agent. The save
 * path is the same for both; the machine never saves.
 */
export default function StoryWorkspace({ initialStory = null }) {
  const router = useRouter();
  const [form, setForm] = useState(() => (initialStory ? storyToForm(initialStory) : createEmptyForm()));
  const [activeBlockId, setActiveBlockId] = useState(() => (initialStory?.id ? `story-${initialStory.id}-0` : "draft-0"));
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [draftingKey, setDraftingKey] = useState(null);
  const [draftProgress, setDraftProgress] = useState("");
  const [pendingDraftJob, setPendingDraftJob] = useState(null);
  const stopWatchingRef = useRef(null);
  const [mode, setMode] = useState("write"); // "write" | "preview"
  const [railTab, setRailTab] = useState("agent"); // "source" | "checks" | "agent"
  const [passages, setPassages] = useState(null);
  const [showPublishCheck, setShowPublishCheck] = useState(false);
  const [proposalPending, setProposalPending] = useState(false);
  const [conflict, setConflict] = useState("");
  const [savedAt, setSavedAt] = useState(null);
  /* A signature of everything a save would send. Compared against the last
     saved one to know whether there is unsaved work, which gates autosave,
     the navigation guard, and whether the agent may act. */
  const savedSignatureRef = useRef(null);

  const reviewMode = Boolean(form.provenance && form.id);

  useEffect(() => () => { if (stopWatchingRef.current) stopWatchingRef.current(); }, []);

  useEffect(() => {
    if (!reviewMode || passages) return;
    let alive = true;
    getStoryPassages(form.id).then((r) => { if (alive) setPassages(r.ok ? r.data.passages : []); });
    return () => { alive = false; };
  }, [reviewMode, form.id, passages]);

  const plainTextContent = useMemo(() => getPlainTextFromBlocks(form.bodyBlocks), [form.bodyBlocks]);
  const totalWords = useMemo(() => plainTextContent.split(/\s+/).filter(Boolean).length, [plainTextContent]);
  const readingTime = Math.max(1, Math.ceil(totalWords / 200 || 1));
  const audience = form.provenance?.audience || "adults";
  const prose = useMemo(() => form.bodyBlocks.filter((b) => b.type === "paragraph").map((b) => plainText(b.html)).join("\n\n"), [form.bodyBlocks]);
  const assessment = useMemo(() => (reviewMode ? assessForAudience(prose, audience) : null), [reviewMode, prose, audience]);
  const summary = useMemo(() => summariseBlocks(form.bodyBlocks), [form.bodyBlocks]);
  const sections = useMemo(() => (reviewMode ? sectionsOf(form.bodyBlocks) : []), [reviewMode, form.bodyBlocks]);
  const signature = useMemo(() => JSON.stringify({
    title: form.title,
    subtitle: form.subtitle,
    excerpt: form.excerpt,
    scheduledFor: form.scheduledFor,
    cover: form.coverImageId || (form.coverFile ? "pending" : null),
    blocks: form.bodyBlocks.map((b) => [b.type, b.html || "", b.caption || "", b.alt || "", b.width || "", b.imageId || ""]),
  }), [form]);
  if (savedSignatureRef.current === null) savedSignatureRef.current = signature;
  const dirty = savedSignatureRef.current !== signature;

  const activeBlock = form.bodyBlocks.find((b) => b.id === activeBlockId) || null;
  const agentContext = useMemo(() => {
    const i = form.bodyBlocks.findIndex((b) => b.id === activeBlockId);
    if (i < 0) return null;
    const b = form.bodyBlocks[i];
    return { index: i + 1, type: b.type, text: b.type === "image" ? (b.caption || "image") : plainText(b.html).slice(0, 90) };
  }, [form.bodyBlocks, activeBlockId]);
  const sourceLabel = pendingDraftJob
    ? shortSourceLabel({ title: pendingDraftJob.sourceTitle, year: pendingDraftJob.sourceYear })
    : form.provenance
      ? shortSourceLabel({ title: form.provenance.title, year: form.provenance.year })
      : "";

  function releasePreviewUrl() {
    if (form.coverPreviewUrl) URL.revokeObjectURL(form.coverPreviewUrl);
    for (const block of form.bodyBlocks) if (block.type === "image" && block.previewUrl) URL.revokeObjectURL(block.previewUrl);
  }

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateBodyBlocks(bodyBlocks) {
    setForm((current) => ({ ...current, bodyBlocks }));
  }

  const goToBlock = useCallback((index, rail = null) => {
    const block = form.bodyBlocks[index];
    if (!block) return;
    setMode("write");
    setActiveBlockId(block.id);
    if (rail) setRailTab(rail);
    window.requestAnimationFrame(() => {
      document.querySelector(`[data-block-id="${block.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [form.bodyBlocks]);

  /* Autosave, drafts only.
     A published story is live, so its text never changes without the scholar
     pressing Save. A draft is theirs alone, so it saves itself shortly after
     they stop typing. It stands down while a proposal is waiting, because
     saving would put the story a version ahead of what the agent proposed
     against and the accept would then be refused. */
  const canAutosave = Boolean(form.id) && form.status === "draft" && !conflict && !proposalPending;
  useEffect(() => {
    if (!canAutosave || !dirty || isSaving) return undefined;
    const t = setTimeout(() => { submitStory("draft", { auto: true }); }, 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAutosave, dirty, isSaving, signature]);

  /* Closing the tab with work that was never saved. */
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /* The agent accepted a proposal: the API returned the story as saved. */
  const handleStoryChanged = useCallback((story) => {
    releasePreviewUrl();
    const next = storyToForm(story);
    savedSignatureRef.current = null;
    setForm(next);
    setActiveBlockId(next.bodyBlocks[0]?.id || null);
    setFeedback("The change is in. Read it once more before you publish.");
    router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  /* ── the legacy panel: a draft placed into a blank editor ─────────────── */
  function placeDraft(job, source) {
    const draft = job.draft || {};
    const stamped = (draft.bodyBlocks || []).map((block) =>
      block.type === "image" || !Array.isArray(block.sourceRefs) || block.sourceRefs.length === 0 ? block : { ...block, draftedText: plainText(block.html) },
    );
    const incoming = createInitialBlocks(stamped, `drafted-${Date.now()}`);
    setForm((current) => {
      const hasText = getPlainTextFromBlocks(current.bodyBlocks).trim().length > 0;
      const hasImages = current.bodyBlocks.some((block) => block.type === "image");
      return {
        ...current,
        title: current.title.trim() ? current.title : draft.title || "",
        subtitle: current.subtitle.trim() ? current.subtitle : draft.subtitle || "",
        excerpt: current.excerpt.trim() ? current.excerpt : draft.excerpt || "",
        bodyBlocks: hasText || hasImages ? [...current.bodyBlocks, ...incoming] : incoming,
      };
    });
    setActiveBlockId(incoming[0]?.id || null);
    setMode("write");
    setPendingDraftJob({ id: job.id, sourceTitle: job.source?.title || source.title, sourceYear: job.source?.year || source.year || null });
    const notes = Array.isArray(job.warnings) && job.warnings.length ? ` ${job.warnings.join(" ")}` : "";
    setFeedback(`Drafted ${Number(draft.words || 0).toLocaleString()} words from “${job.source?.title || source.title}”. This is a machine first draft under your name — read every line before you publish.${notes}`);
  }

  async function handleDraft(source, audienceChoice) {
    setError("");
    setFeedback("");
    setDraftProgress("Starting…");
    setDraftingKey(`${source.origin}:${source.id}`);
    const created = await createDraftJob({ origin: source.origin, sourceId: source.id, audience: audienceChoice, createStory: false });
    if (!created.ok) { setError(created.error); setDraftingKey(null); setDraftProgress(""); return; }
    const job = created.data.job;
    if (job.status === "awaiting_review") { setDraftingKey(null); setDraftProgress(""); placeDraft(job, source); return; }
    if (job.terminal) { setError(job.failure?.sentence || "That draft did not complete."); setDraftingKey(null); setDraftProgress(""); return; }
    if (stopWatchingRef.current) stopWatchingRef.current();
    stopWatchingRef.current = watchDraftJob(job.id, {
      onProgress: ({ message }) => setDraftProgress(message),
      onSettled: (settled) => {
        stopWatchingRef.current = null;
        setDraftingKey(null);
        setDraftProgress("");
        if (settled.status === "awaiting_review") placeDraft(settled, source);
        else setError(settled.failure?.sentence || "That draft did not complete.");
      },
      onError: (message) => { stopWatchingRef.current = null; setDraftingKey(null); setDraftProgress(""); setError(message); },
    });
  }

  /* ── cover image ──────────────────────────────────────────────────────── */
  function handleCoverFileChange(event) {
    const file = event.target.files?.[0] || null;
    setForm((current) => {
      if (current.coverPreviewUrl) URL.revokeObjectURL(current.coverPreviewUrl);
      return {
        ...current, coverImageId: null, coverImageUrl: "", coverImageFilename: file?.name || "", coverFile: file,
        coverPreviewUrl: file ? URL.createObjectURL(file) : "", retainedImageIds: current.retainedImageIds.filter((id) => id !== current.coverImageId),
      };
    });
  }

  function clearCoverSelection() {
    setForm((current) => {
      if (current.coverPreviewUrl) URL.revokeObjectURL(current.coverPreviewUrl);
      return { ...current, coverImageId: null, coverImageUrl: "", coverImageFilename: "", coverFile: null, coverPreviewUrl: "", retainedImageIds: current.retainedImageIds.filter((id) => id !== current.coverImageId) };
    });
  }

  /* ── save ─────────────────────────────────────────────────────────────── */
  async function submitStory(nextStatus, { auto = false } = {}) {
    setError("");
    if (!auto) setFeedback("");
    setIsSaving(true);
    const { serializedBlocks, inlineImages, inlineImageKeys, retainedInlineImageIds } = collectInlineImagePayload(form.bodyBlocks);
    const retainedIds = [...(form.coverImageId ? [form.coverImageId] : []), ...retainedInlineImageIds];
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
    if (form.id && form.version) payload.set("baseVersion", String(form.version));
    if (pendingDraftJob?.id) payload.set("draftJobId", pendingDraftJob.id);
    if (form.coverFile) payload.append("coverImage", form.coverFile);
    for (const image of inlineImages) payload.append("inlineImages", image);

    const endpoint = form.id ? `${AUTH_API_URL}/api/editorial-stories/${form.id}` : `${AUTH_API_URL}/api/editorial-stories`;
    const method = form.id ? "PATCH" : "POST";
    try {
      const response = await fetch(endpoint, { method, body: payload, credentials: "include" });
      if (response.status === 409) {
        /* Someone else's version landed first. Nothing was written, so the
           scholar's text is still in front of them; they choose what to do. */
        setConflict(await readError(response));
        return false;
      }
      if (!response.ok) { setError(await readError(response)); return false; }
      const result = await response.json();
      const savedStory = result?.story;
      if (!savedStory) { setError("Story save failed."); return false; }
      setSavedAt(new Date());
      if (auto) {
        /* An autosave must never touch the body. Re-rendering a block would
           reset the editable element's HTML and throw the caret to the top
           while the scholar is still typing. Only what a save returns about
           the story itself is taken. */
        savedSignatureRef.current = signature;
        setForm((current) => ({
          ...current,
          version: savedStory.version ?? current.version,
          updatedAt: savedStory.updatedAt || current.updatedAt,
          status: savedStory.status || current.status,
          effectiveStatus: savedStory.effectiveStatus || current.effectiveStatus,
          publicUrl: savedStory.publicUrl ?? current.publicUrl,
        }));
        return true;
      }
      releasePreviewUrl();
      const nextForm = storyToForm(savedStory);
      savedSignatureRef.current = null;
      setForm(nextForm);
      setActiveBlockId((current) => (nextForm.bodyBlocks.some((b) => b.id === current) ? current : nextForm.bodyBlocks[0]?.id || null));
      setFeedback(nextStatus === "published" ? "Story published." : nextStatus === "scheduled" ? "Story scheduled." : "Draft saved.");
      if (pendingDraftJob) setPendingDraftJob(null);
      if (!form.id) router.replace(`/editorial/${savedStory.id}`);
      else router.refresh();
      return true;
    } finally {
      setIsSaving(false);
    }
  }

  const effectiveCoverImageUrl = form.coverPreviewUrl || form.coverImageUrl;
  const hasCover = Boolean(effectiveCoverImageUrl);
  const statusPill = reviewMode && form.status === "draft"
    ? { cls: "sc-write-status is-review", text: "Machine draft · in review" }
    : { cls: "sc-write-status", text: form.id ? `Editing ${form.status}` : "New draft" };

  const editorColumn = (
    <div className="sc-write-canvas">
      {hasCover ? (
        <div className="sc-write-cover">
          <img src={effectiveCoverImageUrl} alt={form.coverImageFilename || "Cover"} />
          <div className="sc-write-cover-actions">
            <label className="sc-write-cover-btn">Replace<input type="file" accept="image/*" onChange={handleCoverFileChange} hidden /></label>
            <button type="button" className="sc-write-cover-btn is-remove" onClick={clearCoverSelection}>Remove</button>
          </div>
        </div>
      ) : (
        <label className="sc-write-addcover"><FaPlus size={13} aria-hidden /> Add a cover image<input type="file" accept="image/*" onChange={handleCoverFileChange} hidden /></label>
      )}
      <input type="text" className="sc-write-title" placeholder="Title" value={form.title} onChange={(event) => updateField("title", event.target.value)} />
      <input type="text" className="sc-write-subtitle" placeholder="Add a subtitle…" value={form.subtitle} onChange={(event) => updateField("subtitle", event.target.value)} />
      <div className="sc-write-body">
        <RichTextBlockEditor blocks={form.bodyBlocks} onChange={updateBodyBlocks} activeBlockId={activeBlockId} onActiveBlockChange={setActiveBlockId} sourceLabel={sourceLabel} />
      </div>

      {!reviewMode ? (
        <>
          {form.provenance?.line ? <p className="sc-write-provenance">{form.provenance.line}</p> : null}
          <DraftSourcesPanel onDraft={handleDraft} draftingKey={draftingKey} progress={draftProgress} />
        </>
      ) : null}

      <details className="sc-write-settings">
        <summary><FaGear size={13} aria-hidden /> Story settings &amp; scheduling</summary>
        <div className="sc-write-settings-body">
          <label className="sc-write-field"><span>Summary / deck</span><textarea className="sc-write-input" rows={2} placeholder="A short summary shown in the feed and previews" value={form.excerpt} onChange={(event) => updateField("excerpt", event.target.value)} /></label>
          <label className="sc-write-field"><span>Schedule publish time</span><input type="datetime-local" className="sc-write-input" value={form.scheduledFor} onChange={(event) => updateField("scheduledFor", event.target.value)} /></label>
          <div className="sc-write-settings-actions">
            <button type="button" className="sc-write-secondary" onClick={() => submitStory("scheduled")} disabled={isSaving}>Schedule</button>
            {form.id && form.status !== "draft" ? <button type="button" className="sc-write-secondary" onClick={() => submitStory("draft")} disabled={isSaving}>Unpublish</button> : null}
            {form.publicUrl ? <a href={form.publicUrl} className="sc-write-link" target="_blank" rel="noreferrer">View live story <FaArrowUpRightFromSquare size={11} aria-hidden /></a> : null}
            {form.id ? <span style={{ marginLeft: "auto" }}><DeleteStoryButton storyId={form.id} title={form.title} redirectTo="/editorial" /></span> : null}
          </div>
        </div>
      </details>
    </div>
  );

  return (
    <div className={`sc-writer mode-${mode}${reviewMode ? " is-review" : ""}`}>
      <div className="sc-write-bar">
        <div className="sc-write-bar-left">
          <Link href="/editorial" className="sc-write-back"><FaArrowLeft size={12} aria-hidden /> Stories</Link>
          <span className={statusPill.cls}>{statusPill.text}</span>
          {form.publicUrl ? (
            <a className="sc-write-live" href={form.publicUrl} target="_blank" rel="noreferrer">View as reader <FaArrowUpRightFromSquare size={10} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a>
          ) : null}
          <span className="sc-write-metatext">
            {reviewMode && form.provenance?.title ? <>Drawn from “{form.provenance.title}” · </> : null}
            {totalWords} {totalWords === 1 ? "word" : "words"} &middot; {readingTime} min &middot; {formatDate(form.updatedAt)}
          </span>
        </div>
        <div className="sc-write-bar-right">
          <span className="sc-write-saved">
            {isSaving ? "Saving…" : dirty ? (form.status === "draft" ? "Unsaved · saving shortly" : "Unsaved changes") : savedAt ? "Saved" : `v${form.version}`}
          </span>
          {reviewMode && summary.attention > 0 ? <span className="sc-write-attention">{summary.attention} paragraph{summary.attention === 1 ? "" : "s"} need{summary.attention === 1 ? "s" : ""} your attention</span> : null}
          <button type="button" className="sc-write-ghost" onClick={() => setMode(mode === "write" ? "preview" : "write")}>{mode === "write" ? "Preview" : "Keep writing"}</button>
          <button type="button" className="sc-write-secondary" onClick={() => submitStory("draft")} disabled={isSaving || proposalPending}>{isSaving ? "Saving…" : "Save draft"}</button>
          {reviewMode ? (
            <button type="button" className="sc-write-publish" onClick={() => setShowPublishCheck(true)} disabled={isSaving || proposalPending || dirty}>Publish check</button>
          ) : (
            <button type="button" className="sc-write-publish" onClick={() => submitStory("published")} disabled={isSaving}>Publish</button>
          )}
        </div>
      </div>

      {conflict ? (
        <p className="sc-write-msg is-error">
          {conflict}{" "}
          <button type="button" className="del-yes" onClick={() => window.location.reload()}>Reload the current version</button>
        </p>
      ) : null}
      {error ? <p className="sc-write-msg is-error">{error}</p> : null}
      {feedback ? <p className="sc-write-msg is-ok">{feedback}</p> : null}
      {proposalPending ? <p className="sc-write-msg is-ok">The agent has proposed a change. Accept or reject it in the Agent tab before saving.</p> : null}

      {mode === "preview" ? (
        <div className="sc-write-previewpane">
          <div className="sc-write-preview-tag">Draft preview &middot; reader view</div>
          <StoryPreview title={form.title} subtitle={form.subtitle} excerpt={form.excerpt} coverImageUrl={effectiveCoverImageUrl} coverImageFilename={form.coverImageFilename} bodyBlocks={form.bodyBlocks.map((block) => (block.type === "image" ? { ...block, url: block.previewUrl || block.imageUrl } : block))} />
        </div>
      ) : !reviewMode ? (
        editorColumn
      ) : (
        <div className="ws-grid">
          <aside className="ws-left">
            <span className="sc-kicker">Outline</span>
            <nav className="ws-outline">
              {sections.map((s) => (
                <button key={s.id} type="button" className={s.blockIds.includes(activeBlockId) ? "ws-outline-item on" : "ws-outline-item"} onClick={() => { const first = form.bodyBlocks.findIndex((b) => b.id === s.blockIds[0]); if (first >= 0) goToBlock(first); }}>
                  <span className={`st-dot ${s.attention ? "is-warn" : "is-ok"}`} aria-hidden />
                  <span className="ws-outline-text">{s.heading}</span>
                </button>
              ))}
            </nav>
            <div className="sc-divider" />
            <span className="sc-kicker">Legend</span>
            <div className="ws-legend">
              <div><span className="st-dot is-ok" /> Every claim supported</div>
              <div><span className="st-dot is-warn" /> Something to check</div>
              <div><span className="block-chip" style={{ padding: "0 7px" }}>p7</span> Passage it came from</div>
              <div><span className="block-chip is-lost" style={{ padding: "0 7px" }}>edited</span> Your words now</div>
            </div>
          </aside>

          <div className="ws-center">{editorColumn}</div>

          <aside className={railTab === "agent" ? "ws-right is-agent" : "ws-right"}>
            <div className="ws-tabs" role="tablist">
              {[["source", "Source"], ["checks", "Checks"], ["agent", "Agent"], ["history", "History"]].map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={railTab === id} className={railTab === id ? "ws-tab on" : "ws-tab"} onClick={() => setRailTab(id)}>{label}</button>
              ))}
            </div>
            <div className="ws-rail-body">
              {railTab === "source" ? <SourceRail block={activeBlock} passages={passages} provenance={form.provenance} /> : null}
              {railTab === "checks" ? <ChecksRail blocks={form.bodyBlocks} assessment={assessment} audience={audience} warnings={initialStory?.draftWarnings} onGoTo={(i) => goToBlock(i, "source")} /> : null}
              {railTab === "history" ? <HistoryRail storyId={form.id} version={form.version} dirty={dirty} onRestored={() => window.location.reload()} /> : null}
              {railTab === "agent" ? <AgentPanel storyId={form.id} context={agentContext} dirty={dirty} onStoryChanged={handleStoryChanged} onProposalPending={setProposalPending} /> : null}
            </div>
          </aside>
        </div>
      )}

      {showPublishCheck ? (
        <PublishCheck
          blocks={form.bodyBlocks}
          assessment={assessment}
          audience={audience}
          author={form.author}
          provenance={form.provenance}
          busy={isSaving}
          onClose={() => setShowPublishCheck(false)}
          onGoTo={(i) => goToBlock(i, "source")}
          onPublish={async () => { const ok = await submitStory("published"); if (ok) setShowPublishCheck(false); }}
          onSchedule={form.scheduledFor ? async () => { const ok = await submitStory("scheduled"); if (ok) setShowPublishCheck(false); } : null}
        />
      ) : null}
    </div>
  );
}
