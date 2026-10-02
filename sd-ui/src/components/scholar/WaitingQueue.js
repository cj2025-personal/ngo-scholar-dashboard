"use client";

import Link from "next/link";
import { useState } from "react";
import {
  HiChevronDown,
  HiChevronUp,
  HiOutlineAcademicCap,
  HiOutlineArrowUpTray,
  HiOutlineCheckCircle,
  HiOutlineDocumentText,
  HiOutlineExclamationTriangle,
  HiOutlineListBullet,
  HiOutlineMicrophone,
  HiOutlinePencil,
  HiOutlineSparkles,
  HiOutlineTrophy,
} from "react-icons/hi2";

import DeleteStoryButton from "@/components/editorial/DeleteStoryButton";
import DiscardJobButton from "@/components/editorial/DiscardJobButton";
import DiscardLevelsButton from "@/components/editorial/DiscardLevelsButton";
import ProposeButton from "@/components/scholar/ProposeButton";

/**
 * Needs you: what is waiting on the scholar, as rows to act on.
 *
 * ── What it keeps from the list it replaced ────────────────────────────────
 * The ranking (the record moving under a claim first, an upload being
 * scanned last), the folding of three or more of a kind into one counted
 * line, a way out of every row the dashboard owns, and a cap on how much it
 * shows before asking whether you want the rest — applied after the sort, so
 * nothing grave can fall off the bottom.
 *
 * ── What it adds ──────────────────────────────────────────────────────────
 * Each row is a thing to do with its icon, its tone and one button, not a
 * paragraph; and when the queue holds more than one kind of thing, chips
 * narrow it to one. The first three rows fit above the fold on a laptop.
 */

/** The way out of a row: discard the job, delete the story, throw away the levels. */
function RemoveAction({ remove }) {
  if (!remove) return null;
  if (remove.kind === "job") return <DiscardJobButton jobId={remove.jobId} />;
  if (remove.kind === "story") return <DeleteStoryButton storyId={remove.storyId} title={remove.title} />;
  if (remove.kind === "levels") return <DiscardLevelsButton storyId={remove.storyId} count={remove.count} />;
  return null;
}

/** How many of one kind before the card says the number instead of listing it. */
const FOLD_AT = 3;
/** How many rows the card shows before it asks whether you want the rest. */
const GLIMPSE = 3;

const FOLDS = {
  record: { lead: (n) => `${n} papers behind your stories have changed on the record`, cta: "See them", href: "/editorial" },
  outline: { lead: (n) => `${n} outlines are waiting for your approval`, cta: "See them", href: "/editorial" },
  "job-draft": { lead: (n) => `${n} drafts are waiting for you`, cta: "See them", href: "/editorial" },
  review: { lead: (n) => `${n} drafts are waiting for your review`, cta: "Review", href: "/editorial?tab=review" },
  levels: { lead: (n) => `${n} stories have reading levels waiting for your approval`, cta: "All stories", href: "/editorial" },
  running: { lead: (n) => `${n} drafts are being written`, cta: "Watch them", href: "/editorial" },
  episode: { lead: (n) => `${n} conversations in your name have not been released`, cta: "All conversations", href: "/podcasts" },
};

/* What each kind of row is, drawn and filed. */
const KINDS = {
  "The record": { icon: HiOutlineExclamationTriangle, chip: "The record" },
  Podcast: { icon: HiOutlineMicrophone, chip: "Podcasts" },
  Outline: { icon: HiOutlineListBullet, chip: "Drafts" },
  Draft: { icon: HiOutlineDocumentText, chip: "Drafts" },
  "In progress": { icon: HiOutlinePencil, chip: "Drafts" },
  "Reading ages": { icon: HiOutlineAcademicCap, chip: "Reading ages" },
  "A paper": { icon: HiOutlineSparkles, chip: "Papers" },
  Legacy: { icon: HiOutlineTrophy, chip: "Legacy" },
  Upload: { icon: HiOutlineArrowUpTray, chip: "Uploads" },
};
const kindOf = (t) => KINDS[t.kind] || { icon: HiOutlineDocumentText, chip: "Other" };

function KindIcon({ t }) {
  const Icon = kindOf(t).icon;
  return (
    <span className={`dash-kind is-${t.tone}`} aria-hidden>
      <Icon size={17} />
    </span>
  );
}

export default function WaitingQueue({ todos }) {
  const [open, setOpen] = useState(false);
  const [openFolds, setOpenFolds] = useState({});
  const [chip, setChip] = useState("All");

  /* The chips, in the order their first row ranks, each with its count. */
  const chips = [];
  for (const t of todos) {
    const c = kindOf(t).chip;
    const found = chips.find((x) => x.name === c);
    if (found) found.count += 1;
    else chips.push({ name: c, count: 1 });
  }
  const showChips = chips.length > 1;
  const visible = chip === "All" ? todos : todos.filter((t) => kindOf(t).chip === chip);

  /* Folds keep the position of their first member, so the tone ranking survives. */
  const blocks = [];
  const folded = new Set();
  for (const t of visible) {
    if (!t.group) {
      blocks.push({ kind: "one", todo: t });
      continue;
    }
    if (folded.has(t.group)) continue;
    const members = visible.filter((x) => x.group === t.group);
    folded.add(t.group);
    if (members.length >= FOLD_AT) blocks.push({ kind: "fold", group: t.group, members });
    else members.forEach((m) => blocks.push({ kind: "one", todo: m }));
  }

  const hidden = Math.max(0, blocks.length - GLIMPSE);
  const shown = open || hidden === 0 ? blocks : blocks.slice(0, GLIMPSE);

  return (
    <section className="st-card dash-card dash-queue" id="st-queue" aria-labelledby="st-queue-title">
      <div className="dash-card__head">
        <div className="dash-card__title">
          <h2 id="st-queue-title" className="dash-h2">Needs you</h2>
          {/* The count of things, not of rows: four lines may stand for nine obligations. */}
          <span className="dash-count" aria-label={`${todos.length} item${todos.length === 1 ? "" : "s"}`}>{todos.length}</span>
        </div>
        {showChips ? (
          <div className="dash-chips" role="group" aria-label="Show">
            {[{ name: "All", count: todos.length }, ...chips].map((c) => (
              <button
                key={c.name}
                type="button"
                className={chip === c.name ? "dash-chip on" : "dash-chip"}
                aria-pressed={chip === c.name}
                onClick={() => { setChip(c.name); setOpen(false); }}
              >
                {c.name} <span>{c.count}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="st-todos dash-rows">
        {shown.map((b, i) =>
          b.kind === "one" ? (
            <Row key={`one-${i}`} t={b.todo} />
          ) : (
            <Fold
              key={`fold-${b.group}`}
              block={b}
              open={Boolean(openFolds[b.group])}
              onToggle={() => setOpenFolds((cur) => ({ ...cur, [b.group]: !cur[b.group] }))}
            />
          ),
        )}
      </div>

      {hidden > 0 ? (
        <button type="button" className="st-more dash-more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? <>Show fewer <HiChevronUp size={14} aria-hidden /></> : <>Show {hidden} more <HiChevronDown size={14} aria-hidden /></>}
        </button>
      ) : null}
    </section>
  );
}

/** Nothing waiting: said plainly, with the way to start. */
export function QueueClear({ draftable }) {
  return (
    <section className="st-card dash-card dash-queue is-clear" id="st-queue" aria-labelledby="st-queue-title">
      <div className="dash-card__head">
        <div className="dash-card__title"><h2 id="st-queue-title" className="dash-h2">Needs you</h2><span className="dash-count is-zero">0</span></div>
      </div>
      <div className="dash-clear">
        <span className="dash-clear__icon" aria-hidden><HiOutlineCheckCircle size={26} /></span>
        <div>
          <p className="dash-clear__lead">Nothing is waiting on you.</p>
          <p className="dash-muted">
            {draftable > 0 ? `${draftable} of your papers can be built on. A story is one click from any of them.` : "When a paper you hold the rights to lands here, you can draft from it."}
          </p>
        </div>
        <Link href={draftable > 0 ? "/editorial/new" : "/papers"} className="dash-btn is-primary">{draftable > 0 ? "Start a story" : "See your papers"}</Link>
      </div>
    </section>
  );
}

/** One thing, on its own terms. */
function Row({ t, inFold = false }) {
  return (
    <div className={`st-todo dash-row is-${t.tone}${inFold ? " is-child" : ""}${t.propose ? " is-invite" : ""}`}>
      {inFold ? <span className={`st-dot is-${t.tone}`} aria-hidden /> : <KindIcon t={t} />}
      <div className="st-todo-body">
        {/* Inside a fold the kind is already said, so the title leads. One
            line each on a wide screen; the whole of it is on hover. */}
        <span className="st-todo-lead" title={inFold ? t.title || t.lead : t.lead}>{inFold ? t.title || t.lead : t.lead}</span>
        <div className="st-todo-detail" title={inFold ? t.meta || t.detail : t.detail}>{inFold ? t.meta || t.detail : t.detail}</div>
      </div>
      <div className="dash-row__actions">
        <RemoveAction remove={t.remove} />
        {t.propose ? <ProposeButton origin={t.propose.origin} sourceId={t.propose.sourceId} className="dash-btn" /> : null}
        <Link href={t.href} className={t.tone === "grave" || (!t.propose && !inFold) ? "dash-btn is-primary" : "dash-btn"}>{t.cta}</Link>
      </div>
    </div>
  );
}

/** Several of one kind, as a count — and as themselves on request. */
function Fold({ block, open, onToggle }) {
  const { group, members } = block;
  const spec = FOLDS[group];
  const tone = members[0].tone;
  const n = members.length;

  return (
    <div className={`st-fold dash-fold is-${tone}${open ? " is-open" : ""}`}>
      <div className={`st-todo dash-row is-${tone} st-fold__head`}>
        <KindIcon t={members[0]} />
        <div className="st-todo-body">
          <span className="st-todo-lead">{spec ? spec.lead(n) : `${n} things are waiting on you`}</span>
          <div className="st-todo-detail">{members[0].title ? <>Most recent: “{members[0].title}”</> : null}</div>
        </div>
        <div className="dash-row__actions">
          <span className="dash-stack" aria-hidden><i /><i /><i /></span>
          <button type="button" className="st-fold__toggle dash-btn is-ghost" aria-expanded={open} onClick={onToggle}>
            {open ? <>Hide <HiChevronUp size={13} aria-hidden /></> : <>Show {n} <HiChevronDown size={13} aria-hidden /></>}
          </button>
          {spec ? <Link href={spec.href} className="dash-btn is-primary">{spec.cta}</Link> : null}
        </div>
      </div>

      {open ? (
        <div className="st-fold__items">
          {members.map((m, i) => <Row key={i} t={m} inFold />)}
        </div>
      ) : null}
    </div>
  );
}
