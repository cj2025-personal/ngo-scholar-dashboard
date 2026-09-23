"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FaArrowLeft,
  FaArrowUpRightFromSquare,
  FaChevronRight,
  FaGear,
  FaPlus,
  FaWandMagicSparkles,
  FaXmark,
} from "react-icons/fa6";

import RichTextBlockEditor, {
  createInitialBlocks,
  getPlainTextFromBlocks,
} from "@/components/editorial/RichTextBlockEditor";
import StoryPreview from "@/components/editorial/StoryPreview";
import AgentConsent from "@/components/editorial/AgentConsent";
import NewStoryAgent from "@/components/editorial/NewStoryAgent";
import AgentPanel from "@/components/editorial/AgentPanel";
import SourceRail from "@/components/editorial/SourceRail";
import ChecksRail, { needsAttention, summariseBlocks } from "@/components/editorial/ChecksRail";
import PublishCheck from "@/components/editorial/PublishCheck";
import DeleteStoryButton from "@/components/editorial/DeleteStoryButton";
import HistoryRail from "@/components/editorial/HistoryRail";
import EvidenceRail from "@/components/editorial/EvidenceRail";
import ReadingLevels from "@/components/editorial/ReadingLevels";
import RecordBanner from "@/components/editorial/RecordBanner";
import { acceptAiTerms, generateStoryLevels, getStoryPassages, recheckStoryBlock } from "@/lib/drafting";
import { plainText, shortSourceLabel } from "@/lib/provenance";
import { AUDIENCE_TARGETS, assessForAudience, normaliseAudience } from "@/lib/readability";

const AUTH_API_URL =
  process.env.NEXT_PUBLIC_AUTH_API_URL || "http://localhost:4000";

/* A judge's verdict in the sentence the scholar is told it in. Both judges
   have a "partial", and it does not mean the same thing in each. */
const VERDICT_WORDS = {
  fidelity: { supported: "supported by its passages", partial: "only partly supported", unsupported: "not supported by its passages" },
  reach: { follows: "following from the paper", partial: "only partly following from the paper", overreach: "going beyond what the paper supports" },
};
const verdictWord = (kind, verdict) => VERDICT_WORDS[kind]?.[verdict] || verdict || "unjudged";

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
    levels: Array.isArray(story?.levels) ? story.levels : [],
    record: story?.record || null,
    evidence: story?.evidence || null,
    draftChecks: story?.draftChecks || null,
    /* Resolved at read time by the API; null for a story written by hand. */
    provenance: story?.provenance || null,
    author: story?.author || null,
  };
}

function createEmptyForm() {
  return storyToForm(null);
}

/**
 * A foldable section of the left rail.
 *
 * Native `<details>`: the disclosure, the keyboard and the open state come
 * with it, and a section the scholar folds stays folded while they read.
 */
function RailSection({ title, count = null, defaultOpen = false, children }) {
  return (
    <details className="ws-sect" open={defaultOpen}>
      <summary className="ws-sect__head">
        <FaChevronRight size={9} className="ws-sect__chev" aria-hidden />
        <span className="sc-kicker">{title}</span>
        {count !== null ? <span className="ws-sect__count">{count}</span> : null}
      </summary>
      <div className="ws-sect__body">{children}</div>
    </details>
  );
}

/**
 * A heading field that wraps and grows.
 *
 * The title and subtitle were `<input>` elements, which cannot wrap: in the
 * review workspace the centre column is about 680px, and any title past
 * roughly thirty-eight characters scrolled out of sight mid-word. The
 * scholar could not read the name of their own article.
 *
 * Enter is swallowed, because these are one paragraph each however many
 * lines they take.
 */
function AutoGrowField({ className, value, placeholder, onChange }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      className={className}
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }}
    />
  );
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
        ...(block.sourceRefs ? { sourceRefs: block.sourceRefs, draftedText: block.draftedText || "", fidelity: block.fidelity || null, ...(block.recheckedAt ? { recheckedAt: block.recheckedAt } : {}) } : {}),
        ...(block.sourceRefs && block.extension ? { extension: true, reach: block.reach || null } : {}),
        ...(block.ownView ? { ownView: true, ...(block.context ? { context: block.context } : {}) } : {}),
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
 * One component, two shapes. A story with no paper behind it yet gets the
 * plain editor, with the agent in a rail beside it: a conversation that ends
 * with a draft landing in the page. A story drafted from a paper gets the
 * review workspace: the outline on the left, the editor in the middle, and on
 * the right the passage behind the block you are on, the checks on the whole
 * draft, and the agent that edits by instruction. The save path is the same
 * for both; the machine never saves.
 *
 * The agent works under terms the scholar agrees to once. Until then the
 * rail is closed and a nudge in the corner asks; after, the rail is open.
 *
 * @param {object|null} initialStory
 * @param {{name?: string, initials?: string}|null} me
 * @param {{version: string, current: boolean}|null} aiTerms   as the profile reports them
 * @param {string|null} initialSource   a paper to start from, `origin:id`
 * @param {string|null} resumeJobId     a paused draft job to pick up
 * @param {boolean} autoPropose         ask the agent for an angle on the paper
 *                                      in `initialSource`, once the terms allow it
 */
export default function StoryWorkspace({ initialStory = null, me = null, aiTerms = null, initialSource = null, resumeJobId = null, autoPropose = false }) {
  const router = useRouter();
  const [form, setForm] = useState(() => (initialStory ? storyToForm(initialStory) : createEmptyForm()));
  const [activeBlockId, setActiveBlockId] = useState(() => (initialStory?.id ? `story-${initialStory.id}-0` : "draft-0"));
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [recheckingId, setRecheckingId] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [draftProgress, setDraftProgress] = useState("");
  const [pendingDraftJob, setPendingDraftJob] = useState(null);
  const stopWatchingRef = useRef(null);
  const [mode, setMode] = useState("write"); // "write" | "preview"
  /* Checks when the draft has something flagged, the agent otherwise. Opening
     on "What should change?" while four paragraphs need a look answers a
     question the scholar has not asked yet. */
  const [railTab, setRailTab] = useState(() =>
    (initialStory?.bodyBlocks || []).some(needsAttention) ? "checks" : "agent");
  const [passages, setPassages] = useState(null);
  const [showPublishCheck, setShowPublishCheck] = useState(false);
  const [proposalPending, setProposalPending] = useState(false);
  const [conflict, setConflict] = useState("");
  const [viewLevel, setViewLevel] = useState(null);
  const [agentPrefill, setAgentPrefill] = useState("");
  const [savedAt, setSavedAt] = useState(null);
  /* The agent's terms: agreed to as they stand, or not yet. The rail opens on
     its own once they are; before that, the nudge asks — at once, when the
     page was opened with a paper or a job in hand. */
  const [terms, setTerms] = useState(aiTerms);
  const consented = Boolean(terms?.current);
  const [railOpen, setRailOpen] = useState(() => Boolean(aiTerms?.current));
  const [consentOpen, setConsentOpen] = useState(() => Boolean(!aiTerms?.current && (initialSource || resumeJobId)));
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentError, setConsentError] = useState("");
  /* A draft the rail just landed, waiting for the save that makes it a
     story; and the other reading ages to write once it is one. */
  const landingRef = useRef(false);
  const pendingLevelsRef = useRef(null);
  /* A signature of everything a save would send. Compared against the last
     saved one to know whether there is unsaved work, which gates autosave,
     the navigation guard, and whether the agent may act. */
  const savedSignatureRef = useRef(null);

  const reviewMode = Boolean(form.provenance && form.id);

  /* The bar is transparent until the page moves under it. See the rule for
     `.sc-write-bar.is-stuck`: at rest it should be the page, and once it is
     covering text it has to be something. */
  const [stuck, setStuck] = useState(false);
  const barRef = useRef(null);
  useEffect(() => {
    const root = document.documentElement;
    /* The rails sit directly under the bar, so they need its height — which
       changes when the bar wraps on a narrow window. Measured rather than
       assumed, because the number that was assumed (118px) was reserving
       room for navigation that scrolls away. */
    const measure = () => {
      const h = barRef.current?.getBoundingClientRect().height;
      if (h) root.style.setProperty("--ws-bar-h", `${Math.round(h)}px`);
    };
    const onScroll = () => setStuck(window.scrollY > 8);
    onScroll();
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", measure);
      root.style.removeProperty("--ws-bar-h");
    };
  }, []);
  /* Provenance is resolved when a story is read. A write's response may
     carry none; adopting that as "no paper behind this" would drop the
     workspace out of review mode mid-edit. What was known stays known. */
  const provenanceRef = useRef(form.provenance);
  provenanceRef.current = form.provenance;
  const withKnownProvenance = (story) => (story && !story.provenance && provenanceRef.current ? { ...story, provenance: provenanceRef.current } : story);

  /* The rail is a fixed pane and the top bar is not: it scrolls away. The
     pane's top follows the bar's lower edge out of view, so there is never a
     gap above the pane once the bar has gone, and never a pane under it
     while it is there. */
  useEffect(() => {
    if (reviewMode || !railOpen) return undefined;
    const root = document.documentElement;
    const bars = [".nb-utility", ".nb-nav"].map((sel) => document.querySelector(sel)).filter(Boolean);
    const place = () => {
      const bottom = Math.max(0, ...bars.map((el) => el.getBoundingClientRect().bottom));
      root.style.setProperty("--ag-rail-top", `${Math.round(bottom)}px`);
    };
    place();
    window.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
      root.style.removeProperty("--ag-rail-top");
    };
  }, [reviewMode, railOpen]);

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

  /* What the agent is asking for, and whether the page should rearrange for
     it. An outline waiting for approval takes the canvas — but only while
     there is nothing in the page to lose sight of. A scholar who has already
     written something keeps their words on screen and reads the outline in
     the rail, because taking their draft away to show a plan is worse than a
     narrow plan. */
  const [agentStage, setAgentStage] = useState(null);
  const handleStageChange = useCallback((stage) => setAgentStage(stage), []);
  const outlineStage = !reviewMode && agentStage === "outline" && totalWords === 0;
  const planRef = useRef(null);

  /* Put the outline on screen the moment the page has rearranged around it.
     This belongs here, not in the rail: the rail's own effect runs before
     this component has switched layouts, so it scrolled the fixed-position
     pane the outline was about to leave. One frame after the canvas is
     committed, the outline is where it can be read. */
  useEffect(() => {
    if (!outlineStage) return undefined;
    const id = requestAnimationFrame(() => {
      const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      planRef.current
        ?.querySelector(".ch-msg.is-outline")
        ?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(id);
  }, [outlineStage]);
  const signature = useMemo(() => JSON.stringify({
    title: form.title,
    subtitle: form.subtitle,
    excerpt: form.excerpt,
    scheduledFor: form.scheduledFor,
    cover: form.coverImageId || (form.coverFile ? "pending" : null),
    /* A tick on a specific in the author's own context is a change to save. */
    blocks: form.bodyBlocks.map((b) => [b.type, b.html || "", b.caption || "", b.alt || "", b.width || "", b.imageId || "", b.context ? (b.context.toVerify || []).filter((v) => v.verified).length : ""]),
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

  /* A server write returned the story as saved: the agent's accept, a level
     written or approved, the record checked. Adopt it whole. */
  const handleStoryChanged = useCallback((story, message = "The change is in. Read it once more before you publish.") => {
    releasePreviewUrl();
    const next = storyToForm(withKnownProvenance(story));
    savedSignatureRef.current = null;
    setForm(next);
    setActiveBlockId((current) => (next.bodyBlocks.some((b) => b.id === current) ? current : next.bodyBlocks[0]?.id || null));
    if (message) setFeedback(message);
    router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  /* The record banner hands the agent an instruction and opens the rail. */
  const askAgent = useCallback((instruction) => {
    setViewLevel(null);
    setRailOpen(true);
    setRailTab("agent");
    setAgentPrefill(instruction);
  }, []);

  /* A tick on a specific the agent brought in from outside the paper: the
     author has checked it. Their word, on their block; the save carries it
     and the publish gate reads it. */
  const verifySpecific = useCallback((blockId, itemIndex, verified) => {
    setForm((current) => ({
      ...current,
      bodyBlocks: current.bodyBlocks.map((b) => (b.id === blockId && b.context
        ? { ...b, context: { ...b.context, toVerify: (b.context.toVerify || []).map((v, k) => (k === itemIndex ? { ...v, verified } : v)) } }
        : b)),
    }));
  }, []);

  /* The author rewrote a flagged paragraph and asks for a fresh verdict.
   *
   * The judge reads the saved article, so this is offered only once the edit
   * has landed; the rail says so rather than silently judging stale text. */
  const recheckBlock = useCallback(async (blockId) => {
    const index = form.bodyBlocks.findIndex((b) => b.id === blockId);
    if (index < 0 || !form.id) return;
    setRecheckingId(blockId);
    setError("");
    const r = await recheckStoryBlock(form.id, index, { baseVersion: form.version });
    setRecheckingId(null);
    if (!r.ok) { setError(r.error); return; }
    handleStoryChanged(
      r.data.story,
      r.data.changed
        ? `Checked again: this paragraph is now ${verdictWord(r.data.kind, r.data.verdict)}.`
        : `Checked again against what it says now; the verdict is unchanged (${verdictWord(r.data.kind, r.data.verdict)}).`,
    );
  }, [form.bodyBlocks, form.id, form.version, handleStoryChanged]);

  /* The author takes a flagged paragraph on as their own.
   *
   * The publish check has always offered this as one of three ways past a
   * paragraph the judge would not pass, and for a while it was the only one
   * with no control behind it: rewriting left the old verdict in place and
   * deleting was the only exit, so a scholar who fixed the paragraph properly
   * stayed blocked. Owning it means it is no longer a claim about the paper,
   * so the citation and the verdict go with it — `normalizeRawBodyBlocks`
   * refuses `ownView` on a block that still carries provenance. The words
   * stay; the reader sees them as the author's. Recoverable from History.
   */
  const markAsOwnView = useCallback((blockId) => {
    setForm((current) => ({
      ...current,
      bodyBlocks: current.bodyBlocks.map((b) => (b.id === blockId
        /* Null, not []: an empty array is truthy, and the save payload spreads
           provenance in on `block.sourceRefs` being set at all. */
        ? { ...b, ownView: true, sourceRefs: null, draftedText: "", fidelity: null, extension: false, reach: null, traceable: null }
        : b)),
    }));
  }, []);

  /* ── the agent's terms, the nudge, and the rail ───────────────────────── */
  const openAgent = useCallback(() => {
    if (!consented) { setConsentError(""); setConsentOpen(true); return; }
    setRailOpen(true);
    setRailTab("agent");
  }, [consented]);

  async function agreeToTerms() {
    setConsentBusy(true);
    setConsentError("");
    const r = await acceptAiTerms(terms?.version);
    setConsentBusy(false);
    if (!r.ok) { setConsentError(r.error); return; }
    setTerms(r.data.aiTerms);
    setConsentOpen(false);
    setRailOpen(true);
    setRailTab("agent");
  }

  /* ── a draft placed into the page ─────────────────────────────────────── */
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

  /* The rail's draft lands in the page, and the page becomes the story:
     the save creates it, links the job for provenance, and opens the review
     workspace at the story's own URL. The other reading ages the scholar
     asked for are written from the story once it exists. */
  function landDraft(job, source, { levels = [] } = {}) {
    placeDraft(job, source);
    pendingLevelsRef.current = levels.length ? levels : null;
    setDraftProgress("Saving the draft under your name…");
    landingRef.current = true;
  }
  useEffect(() => {
    if (!landingRef.current || !pendingDraftJob || isSaving) return;
    landingRef.current = false;
    submitStory("draft");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDraftJob, isSaving]);

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
          levels: Array.isArray(savedStory.levels) ? savedStory.levels : current.levels,
          evidence: savedStory.evidence ?? current.evidence,
          record: savedStory.record ?? current.record,
        }));
        return true;
      }
      releasePreviewUrl();
      const nextForm = storyToForm(withKnownProvenance(savedStory));
      savedSignatureRef.current = null;
      setForm(nextForm);
      setActiveBlockId((current) => (nextForm.bodyBlocks.some((b) => b.id === current) ? current : nextForm.bodyBlocks[0]?.id || null));
      setFeedback(nextStatus === "published" ? "Story published." : nextStatus === "scheduled" ? "Story scheduled." : "Draft saved.");
      if (pendingDraftJob) setPendingDraftJob(null);
      if (!form.id && pendingLevelsRef.current?.length) {
        /* Asked for with the draft; written from the story now that there
           is one. A failure here is a note, never a lost draft — the
           workspace can write them again. */
        setDraftProgress("Writing it for the other reading ages you chose…");
        const wanted = pendingLevelsRef.current;
        pendingLevelsRef.current = null;
        const made = await generateStoryLevels(savedStory.id, { audiences: wanted, baseVersion: savedStory.version });
        if (!made.ok) setError(`The draft is saved. The other reading ages could not be written: ${made.error}`);
      }
      setDraftProgress("");
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
      {/* Textareas, not inputs: a single-line input cannot wrap, so any title
          past about thirty-eight characters was cut mid-word and the article's
          own name was unreadable. They grow to their content and never scroll. */}
      <AutoGrowField className="sc-write-title" placeholder="Title" value={form.title} onChange={(value) => updateField("title", value)} />
      <AutoGrowField className="sc-write-subtitle" placeholder="Add a subtitle…" value={form.subtitle} onChange={(value) => updateField("subtitle", value)} />
      <div className="sc-write-body">
        <RichTextBlockEditor blocks={form.bodyBlocks} onChange={updateBodyBlocks} activeBlockId={activeBlockId} onActiveBlockChange={setActiveBlockId} sourceLabel={sourceLabel} />
      </div>

      {!reviewMode ? (
        <>
          {form.provenance?.line ? <p className="sc-write-provenance">{form.provenance.line}</p> : null}
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
    <div className={`sc-writer mode-${mode}${reviewMode ? " is-review" : ""}${!reviewMode && railOpen && !outlineStage ? " has-rail" : ""}`}>
      <div ref={barRef} className={stuck ? "sc-write-bar is-stuck" : "sc-write-bar"}>
        <div className="sc-write-bar-left">
          <Link href="/editorial" className="sc-write-back"><FaArrowLeft size={12} aria-hidden /> Stories</Link>
          <span className={statusPill.cls}>{statusPill.text}</span>
          {form.publicUrl ? (
            <a className="sc-write-live" href={form.publicUrl} target="_blank" rel="noreferrer">View as reader <FaArrowUpRightFromSquare size={10} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a>
          ) : null}
          {/* The bar carries what changes: where you are, and what is wrong.
              Everything fixed about the story — which paper, how long, when
              it was saved — moved to "This draft" in the rail, where it can
              be read once and folded away. It used to fill the bar with a
              paper title long enough to push the buttons off the edge. */}
          <span className="sc-write-metatext">
            {outlineStage
              ? "Nothing written yet — the outline is waiting for you"
              : `${totalWords.toLocaleString()} ${totalWords === 1 ? "word" : "words"} · ${readingTime} min`}
          </span>
        </div>
        <div className="sc-write-bar-right">
          <span className="sc-write-saved">
            {isSaving ? "Saving…" : dirty ? (form.status === "draft" ? "Unsaved · saving shortly" : "Unsaved changes") : savedAt ? "Saved" : `v${form.version}`}
          </span>
          {/* It used to be a label. Saying what needs doing without offering
              to take you there makes the reader hunt for it in a rail. */}
          {reviewMode && summary.attention > 0 ? (
            <button
              type="button"
              className="sc-write-attention"
              onClick={() => { const i = form.bodyBlocks.findIndex(needsAttention); if (i >= 0) goToBlock(i, "source"); }}
              title="Go to the first paragraph that needs a look"
            >
              {summary.attention} paragraph{summary.attention === 1 ? "" : "s"} need{summary.attention === 1 ? "s" : ""} your attention
            </button>
          ) : null}
          {/* Nothing has been written, so there is nothing to preview, save or
              publish. The bar used to offer all three — Publish loudest of
              all — over an empty document, which is an invitation to publish
              a blank page and a distraction from the only decision on the
              screen. */}
          {outlineStage ? null : (
            <>
              <button type="button" className="sc-write-ghost" onClick={() => setMode(mode === "write" ? "preview" : "write")}>{mode === "write" ? "Preview" : "Keep writing"}</button>
              <button type="button" className="sc-write-secondary" onClick={() => submitStory("draft")} disabled={isSaving || proposalPending}>{isSaving ? "Saving…" : "Save draft"}</button>
              {reviewMode ? (
                <button type="button" className="sc-write-publish" onClick={() => setShowPublishCheck(true)} disabled={isSaving || proposalPending || dirty}>Publish check</button>
              ) : (
                <button type="button" className="sc-write-publish" onClick={() => submitStory("published")} disabled={isSaving}>Publish</button>
              )}
            </>
          )}
        </div>
      </div>

      {conflict ? (
        <p className="sc-write-msg is-error">
          {conflict}{" "}
          {/* Recovery, not destruction — it wore the delete confirmation's red
              button until that component grew a dialog of its own. */}
          <button type="button" className="cf-btn is-inline" onClick={() => window.location.reload()}>Reload the current version</button>
        </p>
      ) : null}
      {error ? <p className="sc-write-msg is-error">{error}</p> : null}
      {feedback ? <p className="sc-write-msg is-ok">{feedback}</p> : null}
      {draftProgress ? <p className="sc-write-msg is-ok" role="status">{draftProgress}</p> : null}
      {proposalPending ? <p className="sc-write-msg is-ok">The agent has proposed a change. Accept or reject it in the Agent tab before saving.</p> : null}
      {reviewMode && form.record?.alerts?.length ? (
        <RecordBanner storyId={form.id} record={form.record} status={form.status} onAskAgent={askAgent} onUnpublish={() => submitStory("draft")} onAcknowledged={(story) => handleStoryChanged(story, "Noted. The alert stays on the story until the record changes.")} />
      ) : null}

      {mode === "preview" ? (
        <div className="sc-write-previewpane">
          <div className="sc-write-preview-tag">Draft preview &middot; reader view</div>
          <StoryPreview title={form.title} subtitle={form.subtitle} excerpt={form.excerpt} coverImageUrl={effectiveCoverImageUrl} coverImageFilename={form.coverImageFilename} bodyBlocks={form.bodyBlocks.map((block) => (block.type === "image" ? { ...block, url: block.previewUrl || block.imageUrl } : block))} />
        </div>
      ) : !reviewMode ? (
        railOpen ? (
          /* ── The outline has the canvas ──────────────────────────────────
             Approving an outline is the decision this whole surface exists
             to serve: it settles what the article is before a word of it is
             written under the scholar's name. It used to be made in a 380px
             rail while 1,000px of the screen showed an empty editor saying
             "Start writing…" — the smallest space on the page for the
             largest decision on it, next to an invitation that contradicted
             the one being answered. So while an outline waits and the page
             is still empty, the plan is the page. */
          /* One mount, two shapes. The agent holds the job, the thread and
             the watcher on the running draft, so it must not be torn down
             and rebuilt when the page rearranges around it: it keeps its
             position in the tree and only the wrappers change. The two
             `null`s below hold their slots so the element after them stays
             at the same index. */
          <div className={outlineStage ? "ws-plan" : "ws-grid is-two"} ref={planRef}>
            {outlineStage ? null : <div className="ws-center">{editorColumn}</div>}
            <aside
              className={outlineStage ? "ws-plan__inner" : "ws-right is-agent"}
              role={outlineStage ? "region" : undefined}
              aria-label={outlineStage ? "The outline, waiting for your approval" : "Agent"}
            >
              {outlineStage ? null : (
                <div className="ag-rail-head">
                  <span className="sc-kicker">Agent</span>
                  <button type="button" className="ag-rail-close" aria-label="Close the agent" onClick={() => setRailOpen(false)}><FaXmark size={13} aria-hidden /></button>
                </div>
              )}
              <div className="ws-rail-body">
                {/* The agent is asked for an angle only once the terms are
                    settled — `terms`, which the consent sheet updates, not the
                    `aiTerms` this page was rendered with. */}
                <NewStoryAgent me={me} initialSource={initialSource} resumeJobId={resumeJobId} autoPropose={autoPropose && Boolean(terms?.current)} hasText={totalWords > 0} onDraftReady={landDraft} onStoryReady={(id) => router.push(`/editorial/${id}`)} onStageChange={handleStageChange} />
              </div>
            </aside>
          </div>
        ) : editorColumn
      ) : (
        <div className="ws-grid">
          {/* Three things, each foldable, in the order they are wanted: where
              you are in the article, what the article is, and what the marks
              mean. The outline is open because it is used while reading; the
              other two are read once. Before this the rail held an outline
              and a legend and then two thirds of a screen of nothing. */}
          <aside className="ws-left">
            <RailSection title="Outline" defaultOpen count={sections.length}>
              <nav className="ws-outline">
                {sections.map((s) => (
                  <button key={s.id} type="button" className={s.blockIds.includes(activeBlockId) ? "ws-outline-item on" : "ws-outline-item"} onClick={() => { const first = form.bodyBlocks.findIndex((b) => b.id === s.blockIds[0]); if (first >= 0) goToBlock(first); }}>
                    <span className={`st-dot ${s.attention ? "is-warn" : "is-ok"}`} aria-hidden />
                    <span className="ws-outline-text">{s.heading}</span>
                  </button>
                ))}
              </nav>
            </RailSection>

            <RailSection title="This draft">
              <dl className="ws-facts">
                {form.provenance?.title ? (
                  <>
                    <dt>Drawn from</dt>
                    <dd title={form.provenance.title}>
                      {form.provenance.url
                        ? <a href={form.provenance.url} target="_blank" rel="noreferrer">{form.provenance.title}</a>
                        : form.provenance.title}
                      {form.provenance.year ? ` (${form.provenance.year})` : ""}
                    </dd>
                  </>
                ) : null}
                <dt>Length</dt>
                <dd>{totalWords.toLocaleString()} words · {readingTime} min</dd>
                <dt>Written for</dt>
                <dd>{AUDIENCE_TARGETS[normaliseAudience(audience)]?.label || "Adults"}</dd>
                <dt>Version</dt>
                <dd>v{form.version} · {formatDate(form.updatedAt)}</dd>
              </dl>
            </RailSection>

            <RailSection title="What the marks mean">
              <div className="ws-legend">
                <div><span className="st-dot is-ok" /> Every claim supported</div>
                <div><span className="st-dot is-warn" /> Something to check</div>
                <div><span className="block-chip" style={{ padding: "0 7px" }}>p7</span> Passage it came from</div>
                <div><span className="block-chip is-context" style={{ padding: "0 7px" }}>yours</span> Your own context</div>
                <div><span className="block-chip is-lost" style={{ padding: "0 7px" }}>edited</span> Your words now</div>
              </div>
            </RailSection>
          </aside>

          <div className="ws-center">
            <ReadingLevels story={{ id: form.id, version: form.version, levels: form.levels, provenance: form.provenance }} viewLevel={viewLevel} onView={setViewLevel} dirty={dirty} onChanged={(story, message) => handleStoryChanged(story, message)} />
            {viewLevel ? null : editorColumn}
          </div>

          <aside className={railTab === "agent" ? "ws-right is-agent" : "ws-right"}>
            <div className="ws-tabs" role="tablist">
              {[["source", "Source"], ["checks", "Checks"], ["evidence", "Evidence"], ["agent", "Agent"], ["history", "History"]].map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={railTab === id} className={railTab === id ? "ws-tab on" : "ws-tab"} onClick={() => (id === "agent" ? openAgent() : setRailTab(id))}>{label}</button>
              ))}
            </div>
            <div className="ws-rail-body">
              {railTab === "source" ? <SourceRail block={activeBlock} passages={passages} provenance={form.provenance} onVerify={verifySpecific} onOwnView={markAsOwnView} onRecheck={form.id ? recheckBlock : null} rechecking={recheckingId === activeBlockId} dirty={dirty} /> : null}
              {railTab === "checks" ? <ChecksRail blocks={form.bodyBlocks} assessment={assessment} audience={audience} warnings={initialStory?.draftWarnings} onVerify={verifySpecific} draftChecks={form.draftChecks} record={form.record} storyId={form.id} levels={form.levels} onGoTo={(i) => goToBlock(i, "source")} onStoryChanged={(story, message) => handleStoryChanged(story, message)} onOpenEvidence={() => setRailTab("evidence")} /> : null}
              {railTab === "evidence" ? <EvidenceRail storyId={form.id} version={form.version} status={form.status} slug={initialStory?.slug} onGoTo={(i) => goToBlock(i, "source")} /> : null}
              {railTab === "history" ? <HistoryRail storyId={form.id} version={form.version} dirty={dirty} onRestored={() => window.location.reload()} /> : null}
              {railTab === "agent" ? (consented ? <AgentPanel storyId={form.id} context={agentContext} dirty={dirty} prefill={agentPrefill} onPrefillTaken={() => setAgentPrefill("")} onStoryChanged={handleStoryChanged} onProposalPending={setProposalPending} /> : (
                <div className="ag-gate">
                  <p className="ag-empty-title">The agent edits by instruction.</p>
                  <p className="st-muted">It works from the paper behind this story and shows every change before it lands. Read its terms once to use it.</p>
                  <button type="button" className="sc-write-secondary st-btn" onClick={openAgent}>Read the terms</button>
                </div>
              )) : null}
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
          storyId={form.id}
          levels={form.levels}
          record={form.record}
          draftChecks={form.draftChecks}
          busy={isSaving}
          onClose={() => setShowPublishCheck(false)}
          onGoTo={(i) => goToBlock(i, "source")}
          onPublish={async () => { const ok = await submitStory("published"); if (ok) setShowPublishCheck(false); }}
          onSchedule={form.scheduledFor ? async () => { const ok = await submitStory("scheduled"); if (ok) setShowPublishCheck(false); } : null}
        />
      ) : null}

      {/* The way in when the rail is closed. */}
      {!reviewMode && !railOpen && mode !== "preview" ? (
        <button type="button" className="ag-nudge" onClick={openAgent} title={consented ? "Open the agent" : "The agent drafts from your papers — read its terms once"}>
          <FaWandMagicSparkles size={14} aria-hidden /> Agent
        </button>
      ) : null}

      {consentOpen ? (
        <AgentConsent version={terms?.version} busy={consentBusy} error={consentError} onAgree={agreeToTerms} onClose={() => setConsentOpen(false)} />
      ) : null}
    </div>
  );
}
