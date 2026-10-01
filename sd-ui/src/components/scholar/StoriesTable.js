"use client";

import Link from "next/link";
import { useState } from "react";
import { HiOutlineArrowRight } from "react-icons/hi2";

import DeleteStoryButton from "@/components/editorial/DeleteStoryButton";

/**
 * Your stories, as a table: what each is, where it stands, who it is for,
 * and what came of it. The rows arrive already worked out by the page; this
 * only narrows them by status and draws them.
 *
 * Reads are "reads", never readers: the count is of readings a browser stayed
 * with, and the same person on two days counts twice. A story never
 * published has no reads column at all rather than a zero, because "no one
 * yet" and "cannot have been read" are different answers.
 *
 * @param {{ rows: object[], total: number }} p
 */
const TABS = [
  { key: "all", label: "All" },
  { key: "review", label: "In review" },
  { key: "published", label: "Published" },
  { key: "draft", label: "Drafts" },
];
const SHOWN = 6;

export default function StoriesTable({ rows, total }) {
  const [tab, setTab] = useState("all");
  const counts = Object.fromEntries(TABS.map((t) => [t.key, t.key === "all" ? rows.length : rows.filter((r) => r.group === t.key).length]));
  const list = (tab === "all" ? rows : rows.filter((r) => r.group === tab)).slice(0, SHOWN);
  const mostReads = Math.max(1, ...rows.map((r) => r.reads?.total || 0));

  return (
    <section className="st-card dash-card dash-stories" aria-labelledby="dash-stories-title">
      <div className="dash-card__head">
        <div className="dash-card__title">
          <h2 id="dash-stories-title" className="dash-h2">Your stories</h2>
          <span className="dash-count is-quiet">{total}</span>
        </div>
        <div className="dash-chips" role="group" aria-label="Show">
          {TABS.filter((t) => t.key === "all" || counts[t.key] > 0).map((t) => (
            <button key={t.key} type="button" className={tab === t.key ? "dash-chip on" : "dash-chip"} aria-pressed={tab === t.key} onClick={() => setTab(t.key)}>
              {t.label} <span>{counts[t.key]}</span>
            </button>
          ))}
          <Link href="/editorial" className="dash-link">All stories <HiOutlineArrowRight size={12} aria-hidden /></Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="dash-muted dash-empty">No stories yet. The first one is a paper and a click away.</p>
      ) : (
        <div className="dash-table" role="table" aria-label="Your stories">
          <div className="dash-tr dash-th" role="row">
            <span role="columnheader">Story</span>
            <span role="columnheader">Status</span>
            <span role="columnheader">Reading ages</span>
            <span role="columnheader">Reads</span>
            <span role="columnheader">Questions</span>
            <span role="columnheader">Updated</span>
            <span role="columnheader" className="sr-only">Actions</span>
          </div>
          {list.map((r) => (
            <div key={r.id} className="dash-tr" role="row">
              <span role="cell" className="dash-td-story">
                <Link href={r.href} className="dash-story-title" title={r.title}>{r.title}</Link>
                <span className="dash-story-from" title={r.from || undefined}>{r.from ? `From “${r.from}”` : "Written by hand"}</span>
              </span>
              <span role="cell"><span className={`dash-status is-${r.group}`}>{r.statusLabel}</span></span>
              <span role="cell" className="dash-td-ages">
                {r.audience ? <span>{r.audience}</span> : <span className="dash-faint">—</span>}
                {r.levelsWritten > 0 ? <span className="dash-faint"> + {r.levelsWritten}</span> : null}
                {r.levelsWaiting > 0 ? <span className="dash-pill is-warn" title={`${r.levelsWaiting} waiting for your approval`}>{r.levelsWaiting} to approve</span> : null}
              </span>
              <span role="cell" className="dash-td-num">
                {r.reads ? (
                  <span className="dash-reads" title={`${r.reads.total.toLocaleString()} reads · ${r.reads.recent.toLocaleString()} this week`}>
                    <b>{r.reads.total.toLocaleString()}</b>
                    <i style={{ width: `${Math.max(4, Math.round((r.reads.total / mostReads) * 44))}px` }} aria-hidden />
                  </span>
                ) : <span className="dash-faint">—</span>}
              </span>
              <span role="cell" className="dash-td-num">
                {r.questions ? (
                  <span title={r.questions.notHere ? `${r.questions.notHere} the story couldn't answer` : undefined}>
                    {r.questions.total.toLocaleString()}
                    {r.questions.notHere ? <span className="dash-pill is-info">{r.questions.notHere} unanswered</span> : null}
                  </span>
                ) : <span className="dash-faint">—</span>}
              </span>
              <span role="cell" className="dash-faint">{r.updated}</span>
              <span role="cell" className="dash-td-act"><DeleteStoryButton storyId={r.id} title={r.title} compact /></span>
            </div>
          ))}
        </div>
      )}
      {rows.length > SHOWN && tab === "all" ? (
        <Link href="/editorial" className="dash-more dash-link">See all {total} stories <HiOutlineArrowRight size={12} aria-hidden /></Link>
      ) : null}
    </section>
  );
}
