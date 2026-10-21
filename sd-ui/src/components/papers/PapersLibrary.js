"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import {
  HiChevronDown,
  HiChevronUp,
  HiOutlineArrowRight,
  HiOutlineArrowTopRightOnSquare,
  HiOutlineArrowUpTray,
  HiOutlineLockClosed,
  HiOutlineSparkles,
} from "react-icons/hi2";

import { storyGroup, STATUS_LABEL } from "@/lib/storyRows";

/**
 * Papers: what we hold of the scholar's work, and what each may be used for.
 *
 * ── What it is for ─────────────────────────────────────────────────────────
 * The inventory the drafter reads, said in the eligibility rule's own words,
 * so what the scholar reads here is what the server will enforce. Each paper
 * says where it came from, what it may be used for and why, how long it is,
 * what has been written from it, and the one thing to do with it.
 *
 * ── What changed ────────────────────────────────────────────────────────────
 * A "Selected paper" panel sat beside the table, chosen for the scholar
 * before they chose anything, repeating the row and offering a second
 * "Start a story". It is gone: the stories drawn from a paper open under its
 * own row, and the side column now explains the three labels and how to add
 * a paper, which is what a scholar reading this page is actually missing.
 * The Year column was dashes on every row (the harvested record carries no
 * year), so a year now shows only where one is known. On a phone each row is
 * a card instead of a table cut off at the screen's edge.
 */

const DOCS_PORTAL_URL =
  process.env.NEXT_PUBLIC_DOCS_PORTAL_URL || "http://localhost:3000/scholar-documents";

const USE = {
  draftable: { label: "Draft from", pill: "dash-pill is-ok", tab: "Ready to draft from" },
  citable: { label: "Quote only", pill: "dash-pill is-info", tab: "Quote only" },
  unusable: { label: "Title only", pill: "dash-pill", tab: "Title only" },
  pending: { label: "Being checked", pill: "dash-pill is-warn", tab: "Being checked" },
};

const MEANINGS = [
  ["draftable", "Licensed in full and long enough: Kivyn can read it and draft a story that stands on its passages."],
  ["citable", "We may quote short passages, not build a story on it. A version you hold the rights to changes that."],
  ["unusable", "We know it exists but hold no text we may use, so it is listed and never quoted. We never guess at a licence."],
  ["pending", "An upload being scanned, extracted or reviewed. It moves to one of the above when that is done."],
];

function fmtDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

const kindOf = (paper) => (paper.pending ? "pending" : paper.use in USE ? paper.use : "unusable");

export default function PapersLibrary({ inventory, stories }) {
  const all = useMemo(() => {
    if (!inventory) return [];
    return [...inventory.draftable, ...inventory.citable, ...inventory.unusable].map((s) => ({
      ...s,
      key: `${s.origin}:${s.id}`,
      kind: kindOf(s),
      stories: (stories || []).filter((st) => st.provenance?.sourceId === s.id),
    }));
  }, [inventory, stories]);

  const counts = Object.fromEntries(["draftable", "citable", "unusable", "pending"].map((k) => [k, all.filter((p) => p.kind === k).length]));
  const tabs = [{ id: "all", label: "All", n: all.length }, ...Object.keys(USE).filter((k) => counts[k]).map((k) => ({ id: k, label: USE[k].tab, n: counts[k] }))];
  const [tab, setTab] = useState("all");
  const [open, setOpen] = useState({});
  const rows = all.filter((p) => tab === "all" || p.kind === tab);
  const canDraft = Boolean(inventory?.eligible);

  if (!inventory) {
    return (
      <div className="dash papers">
        <section className="st-card dash-card"><p className="dash-muted">We couldn&rsquo;t load your papers. Refresh to try again.</p></section>
      </div>
    );
  }

  return (
    <div className="dash papers">
      <header className="dash-head">
        <div>
          <p className="dash-date">Papers</p>
          <h1 className="dash-greet">Your papers</h1>
          <p className="pods-intro">What Proj Arch holds of your work, and what each may be used for, in the words of the rule that decides it.</p>
        </div>
        <a href={DOCS_PORTAL_URL} target="_blank" rel="noreferrer" className="dash-btn is-primary papers-add">
          <HiOutlineArrowUpTray size={15} aria-hidden /> Add a paper
        </a>
      </header>

      <div className="dash-grid">
        <div className="dash-col-main">
          <section className="st-card dash-card papers-card" aria-labelledby="papers-title">
            <div className="dash-card__head">
              <div className="dash-card__title">
                <h2 id="papers-title" className="sr-only">Your papers</h2>
                {all.length ? (
                  <div className="dash-chips" role="group" aria-label="Show">
                    {tabs.map((t) => (
                      <button key={t.id} type="button" className={tab === t.id ? "dash-chip on" : "dash-chip"} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
                        {t.label} <span>{t.n}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            {all.length ? (
              <div className="dash-split papers-split" role="img" aria-label={Object.keys(USE).filter((k) => counts[k]).map((k) => `${counts[k]} ${USE[k].label.toLowerCase()}`).join(", ")}>
                {Object.keys(USE).filter((k) => counts[k]).map((k) => <i key={k} className={`is-${k}`} style={{ flexGrow: counts[k] }} />)}
              </div>
            ) : null}

            {rows.length === 0 ? (
              <p className="dash-muted papers-none">
                {all.length ? "Nothing here." : "We hold nothing of your work yet. Add a paper you hold the rights to, and it appears here once it has been checked."}
              </p>
            ) : (
              <table className="pp-table">
                <thead>
                  <tr>
                    <th scope="col">Paper</th>
                    <th scope="col">May be used for</th>
                    <th scope="col" className="is-num">Words</th>
                    <th scope="col">Stories</th>
                    <th scope="col"><span className="sr-only">Action</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const use = USE[p.kind];
                    const isOpen = Boolean(open[p.key]);
                    const subId = `pp-sub-${p.key.replace(/[^\w-]/g, "-")}`;
                    return (
                      <Fragment key={p.key}>
                        <tr className={`is-${p.kind}${isOpen ? " is-open" : ""}`}>
                          <td className="pp-cell-paper">
                            <span className="pp-title">{p.title}</span>
                            <span className="pp-from">
                              {p.origin === "contributed" ? (
                                <>Uploaded by you{fmtDate(p.uploadedAt) ? ` · ${fmtDate(p.uploadedAt)}` : ""}</>
                              ) : p.url ? (
                                <a href={p.url} target="_blank" rel="noreferrer">{p.host || "Public source"}<HiOutlineArrowTopRightOnSquare size={11} aria-hidden /></a>
                              ) : (
                                <>From public sources{p.host ? ` · ${p.host}` : ""}</>
                              )}
                              {p.year ? ` · ${p.year}` : ""}
                            </span>
                          </td>
                          <td className="pp-cell-use">
                            <span className={use.pill}>{use.label}</span>
                            <span className="pp-reason" title={p.reason}>{p.reason}</span>
                          </td>
                          <td className="pp-cell-words is-num">{p.words ? p.words.toLocaleString() : "—"}</td>
                          <td className="pp-cell-stories">
                            {p.stories.length ? (
                              <button type="button" className="pp-stories-btn" aria-expanded={isOpen} aria-controls={subId} onClick={() => setOpen((o) => ({ ...o, [p.key]: !o[p.key] }))}>
                                {p.stories.length} {p.stories.length === 1 ? "story" : "stories"}
                                {isOpen ? <HiChevronUp size={14} aria-hidden /> : <HiChevronDown size={14} aria-hidden />}
                              </button>
                            ) : (
                              <span className="dash-faint">None yet</span>
                            )}
                          </td>
                          <td className="pp-cell-act">
                            {p.kind === "draftable" && canDraft ? (
                              <Link href={`/editorial/new?source=${encodeURIComponent(p.key)}`} className="dash-btn">
                                <HiOutlineSparkles size={15} aria-hidden /> Start a story
                              </Link>
                            ) : p.kind === "draftable" ? (
                              <span className="pp-locked" title={inventory.gateReason || "Drafting is not open to you yet"}>
                                <HiOutlineLockClosed size={14} aria-hidden /> Not open yet
                              </span>
                            ) : p.kind === "citable" ? (
                              <a href={DOCS_PORTAL_URL} target="_blank" rel="noreferrer" className="dash-link">Add a version you own <HiOutlineArrowTopRightOnSquare size={12} aria-hidden /></a>
                            ) : null}
                          </td>
                        </tr>
                        {isOpen ? (
                          <tr className="pp-sub" id={subId}>
                            <td colSpan={5}>
                              <ul className="prof-list">
                                {p.stories.map((st) => {
                                  const g = storyGroup(st);
                                  return (
                                    <li key={st.id}>
                                      <Link href={`/editorial/${st.id}`}>{st.title || "Untitled story"}</Link>
                                      <span className="prof-list__meta"><span className={`dash-status is-${g}`}>{STATUS_LABEL[g]}</span></span>
                                    </li>
                                  );
                                })}
                              </ul>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </div>

        <aside className="dash-col-side">
          {!canDraft ? (
            <section className="st-card dash-card dash-side-card papers-gate" aria-labelledby="papers-gate-title">
              <h2 id="papers-gate-title" className="dash-h3"><HiOutlineLockClosed size={16} aria-hidden /> Drafting is not open to you yet</h2>
              <p className="dash-muted">{inventory.gateReason || "Drafting from your own research opens with Legacy."}</p>
              <Link href="/standing" className="dash-link">Where you stand <HiOutlineArrowRight size={12} aria-hidden /></Link>
            </section>
          ) : null}

          <section className="st-card dash-card dash-side-card" aria-labelledby="papers-mean-title">
            <h2 id="papers-mean-title" className="dash-h3">What the labels mean</h2>
            <dl className="papers-mean">
              {MEANINGS.map(([k, text]) => (
                <div key={k}>
                  <dt><span className={USE[k].pill}>{USE[k].label}</span>{counts[k] ? <span className="dash-faint">{counts[k]}</span> : null}</dt>
                  <dd>{text}</dd>
                </div>
              ))}
            </dl>
            {/* "Add a paper" is the header's; this only says what it does. */}
            <p className="dash-faint papers-mean__note">
              &ldquo;Add a paper&rdquo; uploads a version you hold the rights to. It is scanned and checked, then appears here
              with what it may be used for.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
