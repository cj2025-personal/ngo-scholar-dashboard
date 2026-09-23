"use client";

import Link from "next/link";
import { useState } from "react";
import { HiChevronDown, HiChevronUp } from "react-icons/hi2";

import DeleteStoryButton from "@/components/editorial/DeleteStoryButton";
import DiscardJobButton from "@/components/editorial/DiscardJobButton";
import DiscardLevelsButton from "@/components/editorial/DiscardLevelsButton";
import ProposeButton from "@/components/scholar/ProposeButton";

/**
 * The way out of a queue row.
 *
 * Every row here nags about something, and until this existed only a draft
 * job could be dismissed: a story in review, or reading levels the scholar
 * never wanted, stayed on the list for as long as they existed. Each row now
 * says what removing it means — discard the job, delete the story, throw away
 * the levels — except the two that belong to the Documents portal, where this
 * page has no business deleting anything.
 */
function RemoveAction({ remove }) {
  if (!remove) return null;
  if (remove.kind === "job") return <DiscardJobButton jobId={remove.jobId} />;
  if (remove.kind === "story") return <DeleteStoryButton storyId={remove.storyId} title={remove.title} />;
  if (remove.kind === "levels") return <DiscardLevelsButton storyId={remove.storyId} count={remove.count} />;
  return null;
}

/** How many of one kind before the card says the number instead of listing it. */
const FOLD_AT = 3;
/** How many blocks the card shows before it asks whether you want the rest. */
const GLIMPSE = 4;

/**
 * What a fold of one kind is called, and what a scholar does about all of
 * them at once. The count is always the subject: the dashboard's job is to
 * say how much of a thing is outstanding, and the list surface holds the
 * things themselves.
 */
const FOLDS = {
  record: { lead: (n) => `${n} papers behind your stories have changed on the record`, cta: "See them", href: "/editorial" },
  outline: { lead: (n) => `${n} outlines are waiting for your approval`, cta: "See them", href: "/editorial" },
  "job-draft": { lead: (n) => `${n} drafts are waiting for you`, cta: "See them", href: "/editorial" },
  review: { lead: (n) => `${n} drafts are waiting for your review`, cta: "All drafts", href: "/editorial?tab=drafts" },
  levels: { lead: (n) => `${n} stories have reading levels waiting for your approval`, cta: "All stories", href: "/editorial" },
  running: { lead: (n) => `${n} drafts are being written`, cta: "Watch them", href: "/editorial" },
  /* Conversations generated in the scholar's name that no listener has
     reached yet. The destination is the podcast list, where they are shown
     unreleased-first for the same reason they are in this queue at all. */
  episode: { lead: (n) => `${n} conversations in your name have not been released`, cta: "All conversations", href: "/podcasts" },
};

/**
 * What is waiting on the scholar.
 *
 * ── Why repeats fold ──────────────────────────────────────────────────────
 * The queue's rows are built one per thing, and one per thing is right for a
 * list. It is wrong for a dashboard. Nine drafts from the same paper produced
 * nine rows whose bold line was the same eight words — "A draft is waiting
 * for your review" — nine times, with the only thing that told them apart,
 * the story's own title, set small and grey underneath and truncated. The
 * card was long, it was loud, and it was unreadable: a wall of the same
 * sentence says "something is wrong" and nothing about what.
 *
 * So three or more of a kind fold into one line that gives the count and a
 * way to all of them. Below three they stay as themselves, because "2 drafts
 * are waiting" is a worse line than the two titles.
 *
 * ── And why an unfolded row leads with its title ──────────────────────────
 * Whatever is on the bold line is what the eye compares between rows, so it
 * has to be the thing that differs. Inside a fold the kind has already been
 * said by the line above, so the row can be what it actually is: a story,
 * named, with when it arrived underneath.
 *
 * ── Why the cap is not "the latest four" ──────────────────────────────────
 * The obvious reading of a dashboard glimpse is "the most recent handful".
 * That is right for a feed and wrong here. This list is ranked by how much
 * each row matters — a paper withdrawn from the scientific record first, an
 * upload still being scanned last — and a cap applied to a feed's ordering
 * would let the gravest thing on the page fall off the bottom because three
 * drafts arrived after it. The sort happens first and the cap second.
 */
export default function WaitingQueue({ todos }) {
  const [open, setOpen] = useState(false);
  const [openFolds, setOpenFolds] = useState({});

  /* Folds keep the position of their first member, so the tone ranking
     survives: a fold of drafts sits where the first draft sat. */
  const blocks = [];
  const folded = new Set();
  for (const t of todos) {
    if (!t.group) {
      blocks.push({ kind: "one", todo: t });
      continue;
    }
    if (folded.has(t.group)) continue;
    const members = todos.filter((x) => x.group === t.group);
    folded.add(t.group);
    if (members.length >= FOLD_AT) blocks.push({ kind: "fold", group: t.group, members });
    else members.forEach((m) => blocks.push({ kind: "one", todo: m }));
  }

  const hidden = Math.max(0, blocks.length - GLIMPSE);
  const shown = open || hidden === 0 ? blocks : blocks.slice(0, GLIMPSE);

  return (
    <section className="st-card" id="st-queue" aria-labelledby="st-queue-title">
      <div className="st-card-head">
        <h2 id="st-queue-title" className="st-h2">Waiting on you</h2>
        {/* The count of things, not of rows: the card may show four lines for
            nine obligations, and the header is where that is admitted. */}
        <span className="st-todo-detail">{todos.length} item{todos.length === 1 ? "" : "s"}</span>
      </div>

      <div className="st-todos">
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
        <button type="button" className="st-more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? (
            <>Show fewer <HiChevronUp size={14} aria-hidden /></>
          ) : (
            <>Show {hidden} more <HiChevronDown size={14} aria-hidden /></>
          )}
        </button>
      ) : null}
    </section>
  );
}

/** One thing, on its own terms. */
function Row({ t, inFold = false }) {
  return (
    <div className={`st-todo is-${t.tone}${inFold ? " is-child" : ""}`}>
      <span className={`st-dot is-${t.tone}`} aria-hidden />
      <div className="st-todo-body">
        {/* Inside a fold the kind is already said, so the title leads. */}
        <span className="st-todo-lead">{inFold ? t.title || t.lead : t.lead}</span>
        <div className="st-todo-detail">{inFold ? t.meta || t.detail : t.detail}</div>
      </div>
      <RemoveAction remove={t.remove} />
      {/* When the agent can offer an angle, that is the lead action and saying
          what to write is the quiet one beside it. The blank page is the
          obstacle; the scholar who already knows their angle has lost nothing
          by it being one click over. */}
      {t.propose ? (
        <ProposeButton origin={t.propose.origin} sourceId={t.propose.sourceId} className="sc-write-secondary st-btn" />
      ) : null}
      <Link href={t.href} className={t.tone === "grave" ? "sc-write-secondary st-btn-primary" : "sc-write-secondary st-btn"}>
        {t.cta}
      </Link>
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
    <div className={`st-fold is-${tone}${open ? " is-open" : ""}`}>
      <div className={`st-todo is-${tone} st-fold__head`}>
        <span className={`st-dot is-${tone}`} aria-hidden />
        <div className="st-todo-body">
          <span className="st-todo-lead">{spec ? spec.lead(n) : `${n} things are waiting on you`}</span>
          <div className="st-todo-detail">
            {/* The newest one, named — enough to recognise the pile without
                printing it. The rest are one click away. */}
            {members[0].title ? <>Most recent: “{members[0].title}”</> : null}
          </div>
        </div>
        <button type="button" className="st-fold__toggle" aria-expanded={open} onClick={onToggle}>
          {open ? (
            <>Hide <HiChevronUp size={13} aria-hidden /></>
          ) : (
            <>Show {n} <HiChevronDown size={13} aria-hidden /></>
          )}
        </button>
        {spec ? (
          <Link href={spec.href} className="sc-write-secondary st-btn">{spec.cta}</Link>
        ) : null}
      </div>

      {open ? (
        <div className="st-fold__items">
          {members.map((m, i) => (
            <Row key={i} t={m} inFold />
          ))}
        </div>
      ) : null}
    </div>
  );
}
