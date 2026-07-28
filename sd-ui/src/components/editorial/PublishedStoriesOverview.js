"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  FaArrowUpRightFromSquare,
  FaPen,
} from "react-icons/fa6";

const IMG_BASE = process.env.NEXT_PUBLIC_AUTH_API_URL || "http://localhost:4100";

function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

const KIND_LABEL = { published: "Published", draft: "Draft", scheduled: "Scheduled" };

function rowDate(story, kind) {
  if (kind === "published") return story.publishedAt || story.updatedAt;
  if (kind === "scheduled") return story.scheduledFor || story.updatedAt;
  return story.updatedAt;
}

function StoryRow({ story, kind }) {
  const cover = story.coverImage?.url ? `${IMG_BASE}${story.coverImage.url}` : null;
  const date = formatDate(rowDate(story, kind));
  const minutes = story.wordCount > 0 ? story.readingTimeMinutes : null;

  return (
    <article className="sc-elist-row">
      <div className="sc-elist-main">
        <div className="sc-elist-meta">
          <span className={`sc-elist-pill is-${kind}`}>{KIND_LABEL[kind]}</span>
          {date ? <span>{date}</span> : null}
          {minutes ? <span>&middot; {minutes} min read</span> : null}
        </div>
        <Link href={`/editorial/${story.id}`} className="sc-elist-title">
          {story.title || "Untitled story"}
        </Link>
        {story.excerpt ? <p className="sc-elist-excerpt">{story.excerpt}</p> : null}
        <div className="sc-elist-actions">
          <Link href={`/editorial/${story.id}`}>
            <FaPen size={12} aria-hidden /> Edit
          </Link>
          {story.slug ? (
            <Link href={`/stories/${story.slug}`} target="_blank" rel="noreferrer">
              <FaArrowUpRightFromSquare size={12} aria-hidden /> View live
            </Link>
          ) : null}
        </div>
      </div>
      {cover ? (
        <Link href={`/editorial/${story.id}`} className="sc-elist-thumb" aria-hidden tabIndex={-1}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cover} alt="" />
        </Link>
      ) : null}
    </article>
  );
}

const TABS = [
  { key: "all", label: "All" },
  { key: "published", label: "Published" },
  { key: "drafts", label: "Drafts" },
  { key: "scheduled", label: "Scheduled" },
];

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
    <div className="sc-elist">
      <header className="sc-elist-head">
        <div>
          <h1>Your editorials</h1>
          <p>Long-form stories you&rsquo;re writing and have published.</p>
        </div>
        <Link href="/editorial/new" className="sc-elist-new">
          <FaPen size={14} aria-hidden /> New story
        </Link>
      </header>

      <div className="sc-elist-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === tab}
            className={t.key === tab ? "on" : ""}
            onClick={() => setTab(t.key)}
          >
            {t.label} <b>{counts[t.key]}</b>
          </button>
        ))}
      </div>

      <div className="sc-elist-panel">
        {rows.length > 0 ? (
          rows.map(({ s, kind }) => <StoryRow key={s.id} story={s} kind={kind} />)
        ) : (
          <div className="sc-elist-empty">
            <h3>
              {tab === "all"
                ? "No stories yet"
                : tab === "published"
                  ? "No published stories"
                  : tab === "drafts"
                    ? "No drafts yet"
                    : "No scheduled stories"}
            </h3>
            <p>
              {tab === "published"
                ? "Publish a story and it will appear here."
                : "Start a new editorial to share your research and ideas."}
            </p>
            <Link href="/editorial/new" className="sc-elist-new">
              <FaPen size={14} aria-hidden /> Write a story
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
