"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  HiOutlineArrowTopRightOnSquare,
  HiOutlineBookOpen,
  HiOutlineExclamationTriangle,
  HiOutlinePencilSquare,
} from "react-icons/hi2";

import DeleteStoryButton from "@/components/editorial/DeleteStoryButton";

/**
 * Stories: everything the scholar has written, in one list.
 *
 * ── What it says now that it did not ───────────────────────────────────────
 * It was a title, a date and an excerpt — the list any blog would show. But
 * the things that decide what a scholar does next are not in a title. Whether
 * the paper underneath has moved on the record. Whether reading ages are
 * sitting unapproved and therefore reaching nobody. Which paper it was drawn
 * from at all. Those now sit on the row, so the list answers "what needs me"
 * without opening anything.
 *
 * ── Quiet until asked ──────────────────────────────────────────────────────
 * Edit, View live and Delete used to sit under every row at equal weight,
 * three permanent links per story, one of them destructive. They now appear
 * on hover or focus. Nothing is hidden from a keyboard — `focus-within`
 * reveals them and they keep their place in the tab order — but a list of
 * twelve stories is no longer a list of thirty-six links.
 *
 * ── One "New story" ────────────────────────────────────────────────────────
 * The bar above carries it on every page. A second one at the top of this
 * page was the same button twice on one screen. It survives only in the empty
 * state, where there is nothing else to press.
 */

const IMG_BASE = process.env.NEXT_PUBLIC_AUTH_API_URL || "http://localhost:4100";

const KIND_LABEL = { published: "Published", draft: "Draft", scheduled: "Scheduled" };

const TABS = [
  { key: "all", label: "All" },
  { key: "published", label: "Published" },
  { key: "drafts", label: "Drafts" },
  { key: "scheduled", label: "Scheduled" },
];

function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function rowDate(story, kind) {
  if (kind === "published") return story.publishedAt || story.updatedAt;
  if (kind === "scheduled") return story.scheduledFor || story.updatedAt;
  return story.updatedAt;
}

/** The list carries levels as an array on some routes and a summary on others. */
function levelCounts(story) {
  if (Array.isArray(story.levels)) {
    return {
      live: story.levels.filter((l) => l.approved && !l.stale).length,
      waiting: story.levels.filter((l) => !l.approved && !l.stale).length,
    };
  }
  return { live: story.levels?.live || 0, waiting: story.levels?.waiting || 0 };
}

function StoryRow({ story, kind }) {
  const cover = story.coverImage?.url ? `${IMG_BASE}${story.coverImage.url}` : null;
  const date = formatDate(rowDate(story, kind));
  const minutes = story.wordCount > 0 ? story.readingTimeMinutes : null;
  const levels = levelCounts(story);
  const recordMoved = Boolean(story.record?.alerts?.length) && !story.record?.acknowledgedAt;

  return (
    <article className="el-row">
      <div className="el-row__main">
        <div className="el-row__meta">
          <span className={`sc-elist-pill is-${kind}`}>{KIND_LABEL[kind]}</span>
          {date ? <span>{date}</span> : null}
          {minutes ? <span>· {minutes} min read</span> : null}
        </div>

        <Link href={`/editorial/${story.id}`} className="el-row__title">
          {story.title || "Untitled story"}
        </Link>

        {story.excerpt ? <p className="el-row__excerpt">{story.excerpt}</p> : null}

        {/* What decides whether this one needs the scholar. */}
        <div className="el-row__signals">
          {recordMoved ? (
            <span className="el-sig is-grave">
              <HiOutlineExclamationTriangle size={13} aria-hidden />
              The record moved under this
            </span>
          ) : null}
          {levels.waiting ? (
            <span className="el-sig is-warn">
              <HiOutlineBookOpen size={13} aria-hidden />
              {levels.waiting} reading age{levels.waiting === 1 ? "" : "s"} waiting
            </span>
          ) : levels.live ? (
            <span className="el-sig">
              <HiOutlineBookOpen size={13} aria-hidden />
              {levels.live} reading age{levels.live === 1 ? "" : "s"} live
            </span>
          ) : null}
          {story.provenance?.title ? (
            <span className="el-sig is-quiet">Drawn from “{story.provenance.title}”</span>
          ) : null}
        </div>
      </div>

      {cover ? (
        <Link href={`/editorial/${story.id}`} className="el-row__thumb" aria-hidden tabIndex={-1}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cover} alt="" />
        </Link>
      ) : null}

      {/* Revealed on hover or focus; never removed from the tab order. */}
      <div className="el-row__actions">
        <Link href={`/editorial/${story.id}`} className="el-act">
          <HiOutlinePencilSquare size={14} aria-hidden /> Edit
        </Link>
        {story.slug ? (
          <Link href={`/stories/${story.slug}`} target="_blank" rel="noreferrer" className="el-act">
            <HiOutlineArrowTopRightOnSquare size={14} aria-hidden /> View live
          </Link>
        ) : null}
        <DeleteStoryButton storyId={story.id} title={story.title} compact />
      </div>
    </article>
  );
}

export default function PublishedStoriesOverview({
  publishedStories = [],
  scheduledStories = [],
  draftStories = [],
}) {
  const [tab, setTab] = useState("all");

  const counts = {
    published: publishedStories.length,
    drafts: draftStories.length,
    scheduled: scheduledStories.length,
  };
  counts.all = counts.published + counts.drafts + counts.scheduled;

  const rows = useMemo(() => {
    const tagged = [
      ...publishedStories.map((s) => ({ s, kind: "published" })),
      ...scheduledStories.map((s) => ({ s, kind: "scheduled" })),
      ...draftStories.map((s) => ({ s, kind: "draft" })),
    ];
    const kindFilter =
      tab === "published" ? "published" : tab === "drafts" ? "draft" : tab === "scheduled" ? "scheduled" : null;
    const filtered = kindFilter ? tagged.filter((t) => t.kind === kindFilter) : tagged;
    return filtered.sort((a, b) => {
      const at = new Date(rowDate(a.s, a.kind) || 0).getTime();
      const bt = new Date(rowDate(b.s, b.kind) || 0).getTime();
      return bt - at;
    });
  }, [tab, publishedStories, scheduledStories, draftStories]);

  return (
    <div className="el-page">
      <header className="el-head">
        <h1>Stories</h1>
        <p>Everything you have written, drafted and published.</p>
      </header>

      <div className="el-tabs" role="tablist" aria-label="Filter stories">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === tab}
            className={t.key === tab ? "el-tab on" : "el-tab"}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            <b>{counts[t.key]}</b>
          </button>
        ))}
      </div>

      <div className="el-panel">
        {rows.length > 0 ? (
          rows.map(({ s, kind }) => <StoryRow key={s.id} story={s} kind={kind} />)
        ) : (
          <div className="el-empty">
            <h3>
              {tab === "all"
                ? "No stories yet"
                : tab === "published"
                  ? "Nothing published yet"
                  : tab === "drafts"
                    ? "No drafts"
                    : "Nothing scheduled"}
            </h3>
            <p>
              {tab === "published"
                ? "Publish a story and it will appear here."
                : tab === "all"
                  ? "A story starts from one of your papers. The agent proposes an outline before it writes a word."
                  : "Nothing in this state right now."}
            </p>
            {tab === "all" || tab === "drafts" ? (
              <Link href="/editorial/new" className="el-empty__cta">
                <HiOutlinePencilSquare size={15} aria-hidden /> Start a story
              </Link>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
