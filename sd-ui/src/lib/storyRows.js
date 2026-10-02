import { DRAFT_AUDIENCES } from "@/lib/drafting";

/**
 * A story as a row: one shape and one vocabulary for every table of stories.
 *
 * The Studio's table and the Stories page used to work this out separately,
 * and disagreed: "Draft" was grey on one and orange on the other, scheduled
 * stories were filed under "Published" on one and on their own on the other,
 * and the Stories page could not say how a story was read at all. Both now
 * build their rows here, on the server, so the times they print are worked
 * out once and the two can never drift.
 */

const IMG_BASE = process.env.NEXT_PUBLIC_AUTH_API_URL || "http://localhost:4100";

/* In the order a scholar deals with them. */
export const STORY_GROUPS = [
  { key: "review", label: "In review" },
  { key: "draft", label: "Drafts" },
  { key: "scheduled", label: "Scheduled" },
  { key: "published", label: "Published" },
];

export const STATUS_LABEL = { published: "Published", scheduled: "Scheduled", review: "In review", draft: "Draft" };

/** Where a story stands: a draft Kivyn wrote from a paper is "in review"; one written by hand is a draft. */
export function storyGroup(story) {
  if (story.status === "published") return "published";
  if (story.status === "scheduled") return "scheduled";
  return story.provenance ? "review" : "draft";
}

function formatDate(value, withYear = false) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) }).format(date);
}

function timeAgo(value, now) {
  if (!value) return "";
  const ms = now - new Date(value).getTime();
  if (!Number.isFinite(ms) || ms < 0) return formatDate(value);
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return formatDate(value, new Date(value).getFullYear() !== new Date(now).getFullYear());
}

/**
 * @param {object[]} stories  the API's story summaries
 * @param {{ now?: number }} [opts]
 */
export function buildStoryRows(stories, { now = Date.now() } = {}) {
  return (stories || []).map((s) => {
    const group = storyGroup(s);
    const thisYear = (v) => new Date(v).getFullYear() === new Date(now).getFullYear();
    const updated =
      group === "published" ? formatDate(s.publishedAt || s.updatedAt, !thisYear(s.publishedAt || s.updatedAt))
        : group === "scheduled" ? `For ${formatDate(s.scheduledFor)}`
          : timeAgo(s.updatedAt, now);
    return {
      id: s.id,
      href: `/editorial/${s.id}`,
      liveHref: group === "published" && s.slug ? `/stories/${s.slug}` : null,
      title: s.title || "Untitled story",
      from: s.provenance?.title || null,
      minutes: s.wordCount > 0 ? s.readingTimeMinutes || null : null,
      cover: s.coverImage?.url ? `${IMG_BASE}${s.coverImage.url}` : null,
      group,
      statusLabel: STATUS_LABEL[group],
      /* The record moved under a claim this story makes, and nobody has looked yet: the grave case. */
      recordMoved: Boolean(s.record?.alerts) && !s.record?.acknowledgedAt,
      audience: DRAFT_AUDIENCES.find((a) => a.value === s.provenance?.audience)?.label || null,
      levelsWritten: s.levels?.written || 0,
      levelsWaiting: s.levels?.waiting || 0,
      reads: s.reads || null,
      questions: s.questions || null,
      updated,
      /* Raw values for sorting in the browser. */
      updatedTs: new Date(s.updatedAt || s.createdAt || 0).getTime() || 0,
    };
  });
}
