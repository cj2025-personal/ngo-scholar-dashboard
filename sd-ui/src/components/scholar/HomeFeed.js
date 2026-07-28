"use client";

import Link from "next/link";
import { useState } from "react";
import {
  FaArrowRight,
  FaMicrophone,
  FaPen,
  FaPlay,
} from "react-icons/fa6";
import { avatarClass } from "@/lib/format";

const TABS = ["All", "Editorials", "Podcasts"];

function statusText(status) {
  const s = String(status || "").toLowerCase();
  if (s === "published") return "Published";
  if (s === "draft") return "Draft";
  if (s === "in_review" || s === "review") return "In review";
  return status ? String(status) : "Draft";
}

function metaDate(meta) {
  const match = String(meta || "").match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function storyHref(story) {
  return story.slug ? `/stories/${story.slug}` : `/editorial/${story.id}`;
}

function StoryCard({ story, me }) {
  const published = String(story.status || "").toLowerCase() === "published";
  const date = metaDate(story.meta);
  return (
    <article className="sc-card">
      <div className="sc-author">
        <span className={`sc-av ${avatarClass(me.name)}`} aria-hidden>
          {me.initials}
        </span>
        <div className="who">
          <b>{me.name}</b>
          <span>
            {me.institution || "Your workspace"}
            {date ? (
              <>
                <span className="sc-dot">·</span>
                {date}
              </>
            ) : null}
          </span>
        </div>
        <span className={`sc-status ${published ? "is-published" : "is-draft"}`}>
          {statusText(story.status)}
        </span>
      </div>

      <Link href={storyHref(story)} className="sc-art no-cover">
        <div>
          <h3>{story.title}</h3>
          {story.note ? <p className="ex">{story.note}</p> : null}
        </div>
      </Link>

      <div className="sc-meta">
        <span className="sc-chip">Editorial</span>
        <span className="right">
          <Link href={storyHref(story)} className="sc-open">
            {published ? "Read" : "Open editor"} <FaArrowRight size={11} aria-hidden />
          </Link>
        </span>
      </div>
    </article>
  );
}

function PodcastCard({ episode }) {
  return (
    <article className="sc-card sc-pod">
      <div className="cov" aria-hidden>
        <FaMicrophone size={24} />
        <span className="play">
          <FaPlay size={12} />
        </span>
      </div>
      <div className="body">
        <span className="kicker">Podcast</span>
        <h3>{episode.title || "Untitled episode"}</h3>
        <p>{[episode.type, episode.length].filter(Boolean).join(" · ")}</p>
        {episode.summary ? (
          <p className="sc-pod-summary">{episode.summary}</p>
        ) : null}
      </div>
    </article>
  );
}

export default function HomeFeed({ dashboard, me }) {
  const [tab, setTab] = useState("All");
  const stories = dashboard?.editorialStories || [];
  const podcasts = dashboard?.podcastEpisodes || [];
  const hasAnyContent = stories.length + podcasts.length > 0;

  const showStories = tab === "All" || tab === "Editorials";
  const showPodcasts = tab === "All" || tab === "Podcasts";
  const visibleCount =
    (showStories ? stories.length : 0) + (showPodcasts ? podcasts.length : 0);

  return (
    <>
      <div className="sc-compose">
        <span className="sc-me" aria-hidden>
          {me.initials}
        </span>
        <Link href="/editorial/new" className="prompt">
          Share your research, findings, or a new idea…
        </Link>
        <Link href="/editorial/new" className="go">
          <FaPen size={13} aria-hidden /> Write article
        </Link>
      </div>

      <div className="sc-tabs">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            className={t === tab ? "sc-tab on" : "sc-tab"}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {!hasAnyContent ? (
        <div className="sc-empty">
          <div className="ic" aria-hidden>
            <FaPen size={22} />
          </div>
          <h3>Publish your first story</h3>
          <p>
            Your published editorials and podcast episodes will appear here. Start
            by writing your first article to share your research with the world.
          </p>
          <Link href="/editorial/new" className="go">
            <FaPen size={13} aria-hidden /> Write your first story
          </Link>
        </div>
      ) : visibleCount === 0 ? (
        <div className="sc-empty">
          <h3>Nothing here yet</h3>
          <p>You don&rsquo;t have any {tab.toLowerCase()} yet.</p>
        </div>
      ) : (
        <>
          {showStories &&
            stories.map((story) => (
              <StoryCard key={story.id || story.title} story={story} me={me} />
            ))}
          {showPodcasts &&
            podcasts.map((episode, index) => (
              <PodcastCard key={episode.title || index} episode={episode} />
            ))}
        </>
      )}
    </>
  );
}
