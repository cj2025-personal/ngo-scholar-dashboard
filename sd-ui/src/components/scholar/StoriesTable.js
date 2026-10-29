"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  HiOutlineArrowRight,
  HiOutlineArrowTopRightOnSquare,
  HiOutlineDocumentText,
  HiOutlineEllipsisHorizontal,
  HiOutlineExclamationTriangle,
  HiOutlineMagnifyingGlass,
  HiOutlinePencilSquare,
  HiXMark,
} from "react-icons/hi2";

import DeleteStoryButton from "@/components/editorial/DeleteStoryButton";
import { STORY_GROUPS } from "@/lib/storyRows";

/**
 * The row's other actions, in one menu: edit, read it live, delete. The
 * action the story needs next is beside it, in the open.
 */
function RowMenu({ row }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    /* The delete confirmation is a dialog portalled to the page; a click in it
       is not a click away, or closing the menu would take the confirmation
       (and the delete) down with it. */
    const away = (e) => { if (ref.current && !ref.current.contains(e.target) && !e.target.closest?.("dialog")) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="stories-menu" ref={ref}>
      <button type="button" className="stories-act" aria-haspopup="menu" aria-expanded={open} aria-label={`More for ${row.title}`} title="More" onClick={() => setOpen((v) => !v)}>
        <HiOutlineEllipsisHorizontal size={18} aria-hidden />
      </button>
      {open ? (
        <div className="nb-menu stories-menu__list" role="menu">
          <Link href={row.href} role="menuitem" className="nb-menu__item" onClick={() => setOpen(false)}><HiOutlinePencilSquare size={15} aria-hidden /> Edit</Link>
          {row.liveHref ? (
            <Link href={row.liveHref} role="menuitem" className="nb-menu__item" target="_blank" rel="noreferrer" onClick={() => setOpen(false)}><HiOutlineArrowTopRightOnSquare size={15} aria-hidden /> View live</Link>
          ) : null}
          <div className="nb-menu__rule" />
          <DeleteStoryButton storyId={row.id} title={row.title} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Stories, as a table: what each is, where it stands, who it is for, and
 * what came of it. One component for the Studio's glimpse and the Stories
 * page, so the two say the same thing about the same story.
 *
 *   compact  the Studio: six rows, the tabs, and a way to all of them
 *   full     the Stories page: every story, with search, sort, a cover,
 *            and the row's actions in view rather than on hover
 *
 * The rows arrive worked out on the server (lib/storyRows.js); this only
 * narrows, orders and draws them.
 *
 * Reads are "reads", never readers: the count is of readings a browser stayed
 * with, and the same person on two days counts twice. A story never published
 * shows no reads at all rather than a zero, because "no one yet" and "cannot
 * have been read" are different answers.
 */

const SORTS = [
  { key: "updated", label: "Recently changed", by: (a, b) => b.updatedTs - a.updatedTs },
  { key: "reads", label: "Most read", by: (a, b) => (b.reads?.total ?? -1) - (a.reads?.total ?? -1) || b.updatedTs - a.updatedTs },
  { key: "questions", label: "Most asked about", by: (a, b) => (b.questions?.total ?? -1) - (a.questions?.total ?? -1) || b.updatedTs - a.updatedTs },
  { key: "title", label: "Title, A to Z", by: (a, b) => a.title.localeCompare(b.title) },
];

const COMPACT_ROWS = 6;

export default function StoriesTable({ rows, total = rows.length, variant = "compact", initialTab = "all" }) {
  const full = variant === "full";
  const counts = Object.fromEntries([["all", rows.length], ["needs", rows.filter((r) => r.next?.needsYou).length], ...STORY_GROUPS.map((g) => [g.key, rows.filter((r) => r.group === g.key).length])]);
  /* "Needs you" first among the filters on the Stories page: the rows waiting on a decision. */
  const tabs = [{ key: "all", label: "All" }, ...(full && counts.needs > 0 ? [{ key: "needs", label: "Needs you" }] : []), ...STORY_GROUPS.filter((g) => counts[g.key] > 0)];
  const [tab, setTab] = useState(tabs.some((t) => t.key === initialTab) ? initialTab : "all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("updated");

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const inTab = (r) => tab === "all" || (tab === "needs" ? r.next?.needsYou : r.group === tab);
    const filtered = rows.filter((r) => inTab(r) && (!q || `${r.title} ${r.from || ""}`.toLowerCase().includes(q)));
    const ordered = full ? [...filtered].sort(SORTS.find((s) => s.key === sort).by) : filtered;
    return full ? ordered : ordered.slice(0, COMPACT_ROWS);
  }, [rows, tab, query, sort, full]);
  const mostReads = Math.max(1, ...rows.map((r) => r.reads?.total || 0));

  return (
    <section className={`st-card dash-card dash-stories${full ? " is-full" : ""}`} aria-labelledby="dash-stories-title">
      <div className="dash-card__head">
        <div className="dash-card__title">
          <h2 id="dash-stories-title" className={full ? "sr-only" : "dash-h2"}>Your stories</h2>
          {full ? null : <span className="dash-count is-quiet">{total}</span>}
          {rows.length ? (
            <div className="dash-chips" role="group" aria-label="Show">
              {tabs.map((t) => (
                <button key={t.key} type="button" className={tab === t.key ? "dash-chip on" : "dash-chip"} aria-pressed={tab === t.key} onClick={() => setTab(t.key)}>
                  {t.label} <span>{counts[t.key]}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {full ? (
          rows.length ? (
            <div className="stories-tools">
              <label className="stories-search">
                <HiOutlineMagnifyingGlass size={16} aria-hidden />
                <span className="sr-only">Search your stories</span>
                <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by title or paper" />
              </label>
              <label className="stories-sort">
                <span>Sort</span>
                <select value={sort} onChange={(e) => setSort(e.target.value)}>
                  {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </label>
            </div>
          ) : null
        ) : (
          <Link href="/editorial" className="dash-link">All stories <HiOutlineArrowRight size={12} aria-hidden /></Link>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="dash-muted dash-empty">No stories yet. The first one is a paper and a click away.</p>
      ) : list.length === 0 ? (
        <div className="stories-none">
          <p className="dash-muted">No story {query ? <>matches &ldquo;{query}&rdquo;</> : "here"}{tab !== "all" ? ` under ${tabs.find((t) => t.key === tab)?.label}` : ""}.</p>
          <button type="button" className="dash-btn is-ghost" onClick={() => { setQuery(""); setTab("all"); }}><HiXMark size={14} aria-hidden /> Show every story</button>
        </div>
      ) : (
        <div className="dash-table" role="table" aria-label="Your stories">
          <div className="dash-tr dash-th" role="row">
            <span role="columnheader">Story</span>
            <span role="columnheader">Status</span>
            <span role="columnheader">Reading ages</span>
            <span role="columnheader">Reads</span>
            <span role="columnheader">Questions</span>
            <span role="columnheader">{full && sort === "updated" ? "Changed" : "Updated"}</span>
            <span role="columnheader">{full ? "Next" : <span className="sr-only">Actions</span>}</span>
          </div>
          {list.map((r) => (
            <div key={r.id} className="dash-tr" role="row">
              <span role="cell" className="dash-td-story">
                {full ? (
                  <Link href={r.href} className="stories-thumb" tabIndex={-1} aria-hidden>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {r.cover ? <img src={r.cover} alt="" /> : <HiOutlineDocumentText size={18} />}
                  </Link>
                ) : null}
                <span className="dash-td-story__text">
                  <Link href={r.href} className="dash-story-title" title={r.title}>{r.title}</Link>
                  <span className="dash-story-from" title={r.from || undefined}>
                    {r.from ? `From “${r.from}”` : r.fromBrief ? "From your brief, no paper" : "Written by hand"}
                    {full && r.minutes ? ` · ${r.minutes} min read` : ""}
                  </span>
                </span>
              </span>
              <span role="cell" className="dash-td-status">
                <span className={`dash-status is-${r.group}`}>{r.statusLabel}</span>
                {r.recordMoved ? (
                  <span className="dash-pill is-grave" title="The paper behind this story has changed on the record">
                    <HiOutlineExclamationTriangle size={12} aria-hidden /> Record moved
                  </span>
                ) : null}
              </span>
              <span role="cell" className="dash-td-ages">
                {full ? (
                  /* Each reading age as a chip: green once readers see it, dashed while it waits on you. */
                  <>
                    {r.audience ? <span className={`age-chip${r.group === "published" ? " is-live" : ""}`}>{r.audience}</span> : <span className="dash-faint">Not set</span>}
                    {r.levelBands.map((b) => (
                      <span key={b.audience} className={`age-chip ${b.stale ? "is-stale" : b.approved ? "is-live" : "is-waiting"}`} title={b.stale ? "Out of date: the article changed after it was written" : b.approved ? "Approved: readers can switch to it" : "Waiting for your approval"}>
                        {b.label.replace(/^Ages /, "")}{b.stale ? " · out of date" : b.approved ? "" : " to approve"}
                      </span>
                    ))}
                  </>
                ) : (
                  <>
                    {r.audience ? <span>{r.audience}</span> : <span className="dash-faint">—</span>}
                    {r.levelsWritten > 0 ? <span className="dash-faint"> + {r.levelsWritten}</span> : null}
                    {r.levelsWaiting > 0 ? <span className="dash-pill is-warn" title={`${r.levelsWaiting} waiting for your approval`}>{r.levelsWaiting} to approve</span> : null}
                  </>
                )}
              </span>
              <span role="cell" className="dash-td-num">
                {r.reads ? (
                  <span className="dash-reads" title={`${r.reads.total.toLocaleString()} reads · ${r.reads.recent.toLocaleString()} this week`}>
                    <b>{r.reads.total.toLocaleString()}</b>
                    {r.reads.total ? <i style={{ width: `${Math.max(4, Math.round((r.reads.total / mostReads) * 44))}px` }} aria-hidden /> : null}
                    {full && r.reads.recent ? <span className="dash-faint">{r.reads.recent} this week</span> : null}
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
              <span role="cell" className="dash-td-act">
                {full ? (
                  <>
                    <Link
                      href={r.next.href}
                      className={`dash-btn stories-next${r.next.tone === "primary" ? " is-primary" : r.next.tone === "grave" ? " is-grave" : ""}`}
                      {...(r.next.live ? { target: "_blank", rel: "noreferrer" } : {})}
                    >
                      {r.next.label}{r.next.live ? <HiOutlineArrowTopRightOnSquare size={13} aria-hidden /> : null}
                    </Link>
                    <RowMenu row={r} />
                  </>
                ) : <DeleteStoryButton storyId={r.id} title={r.title} compact />}
              </span>
            </div>
          ))}
        </div>
      )}
      {!full && list.length < rows.length && tab === "all" ? (
        <Link href="/editorial" className="dash-more dash-link">See all {total} stories <HiOutlineArrowRight size={12} aria-hidden /></Link>
      ) : null}
      {full && rows.length ? (
        <p className="dash-footnote stories-foot">Reads, not readers: someone who comes back on another day is counted again.</p>
      ) : null}
    </section>
  );
}
