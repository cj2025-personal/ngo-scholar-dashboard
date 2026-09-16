import Link from "next/link";
import {
  HiOutlineArrowRight,
  HiOutlineArrowUpTray,
  HiOutlineDocumentText,
  HiOutlineSparkles,
} from "react-icons/hi2";

import DeleteStoryButton from "@/components/editorial/DeleteStoryButton";
import DiscardJobButton from "@/components/editorial/DiscardJobButton";
import DiscardLevelsButton from "@/components/editorial/DiscardLevelsButton";

/**
 * The way out of a queue row.
 *
 * Every row here nags about something, and until now only a draft job could
 * be dismissed: a story in review, or reading levels the scholar never
 * wanted, stayed on the list for as long as they existed. Each row now says
 * what removing it means — discard the job, delete the story, throw away the
 * levels — except the two that belong to the Documents portal, where this
 * page has no business deleting anything.
 */
function RemoveAction({ remove }) {
  if (!remove) return null;
  if (remove.kind === "job") return <DiscardJobButton jobId={remove.jobId} />;
  if (remove.kind === "story") return <DeleteStoryButton storyId={remove.storyId} title={remove.title} />;
  if (remove.kind === "levels") return <DiscardLevelsButton storyId={remove.storyId} count={remove.count} />;
  return null;
}

/**
 * Studio: the one thing to do now, then the shape of the work, then the queue.
 *
 * ── Why it is arranged this way ────────────────────────────────────────────
 * It used to be a greeting, a flat run of identical rows, and a thin rail. Two
 * things were wrong with that. Nothing claimed the top of the page, so there
 * was no answer to "what do I do now" without reading every row; and every row
 * looked the same, so a paper being withdrawn from the scientific record sat at
 * the same weight as an upload still being scanned.
 *
 * So, in the order the eye takes them and the order they matter:
 *
 *   1. The next thing. One item, given the size of a decision, with the action
 *      on it. The queue is sorted by how much it matters and this is its head,
 *      so the page leads with the most serious thing outstanding rather than
 *      the most recent.
 *   2. The shape of the work. Four counts — papers that can be built on, drafts
 *      in review, published, waiting on you — each a link to the surface it
 *      describes. A dashboard's job above the fold is to say whether things are
 *      in order, and four numbers do that faster than a list.
 *   3. The rest of the queue, and the stories. Detail, below the fold, for when
 *      the answer to (1) and (2) is "something is off".
 *
 * ── Tone is load-bearing ──────────────────────────────────────────────────
 * `grave` is for the record moving under a published claim and nothing else.
 * It is the one state where the right response might be to unpublish, so it
 * outranks everything and it is the only thing on this page that is red.
 */

const DOCS_PORTAL_URL =
  process.env.NEXT_PUBLIC_DOCS_PORTAL_URL || "http://localhost:3000/scholar-documents";

/* Sorted by what the scholar should deal with first, not what happened last. */
const TONE_RANK = { grave: 0, warn: 1, info: 2, faint: 3 };

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function timeAgo(value) {
  if (!value) return "";
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} hour${h === 1 ? "" : "s"} ago`;
  return formatDate(value);
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function today() {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date());
}

function shortTitle(title, max = 70) {
  const t = String(title || "");
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export default function StudioHome({ me, sources, jobs, stories }) {
  const firstName = (me.name || "").split(/\s+/)[0] || "there";
  const inventory = sources || null;
  const draftable = inventory?.draftable || [];
  const counts = inventory?.counts || { draftable: 0, citable: 0, pending: 0 };
  const all = stories || [];

  /* What needs the scholar. Built in any order; ranked by tone below. */
  const todos = [];
  for (const job of jobs || []) {
    if (job.status === "awaiting_outline") {
      todos.push({ tone: "warn", kind: "Outline", lead: "An outline is waiting for your approval", detail: `“${shortTitle(job.outline?.title || job.source?.title)}” · ${job.outline?.beats?.length || 0} sections proposed · ${timeAgo(job.createdAt)}`, href: `/editorial/new?job=${job.id}`, cta: "Review outline", remove: { kind: "job", jobId: job.id } });
    } else if (job.status === "awaiting_review" && !job.storyId) {
      todos.push({ tone: "warn", kind: "Draft", lead: "A draft is waiting for you", detail: `From “${shortTitle(job.source?.title)}” · ${timeAgo(job.finishedAt)}`, href: `/editorial/new?job=${job.id}`, cta: "Open", remove: { kind: "job", jobId: job.id } });
    } else if (job.status === "running" || job.status === "queued") {
      todos.push({ tone: "info", kind: "In progress", lead: "A draft is being written", detail: `From “${shortTitle(job.source?.title)}” · started ${timeAgo(job.createdAt)}`, href: `/editorial/new?job=${job.id}`, /* A job still running cannot be discarded; one still queued can. */
        cta: "Watch", remove: job.status === "queued" ? { kind: "job", jobId: job.id } : null });
    }
  }
  /* The record moved against a source. Before anything else, always. */
  for (const s of all.filter((st) => st.record?.alerts && !st.record.acknowledgedAt)) {
    todos.push({ tone: "grave", kind: "The record", lead: `The paper behind “${shortTitle(s.title, 50)}” has changed on the record`, detail: s.record.headline, href: `/editorial/${s.id}`, cta: "Deal with it", remove: { kind: "story", storyId: s.id, title: s.title } });
  }
  for (const s of all.filter((st) => st.levels?.waiting > 0)) {
    todos.push({ tone: "warn", kind: "Reading ages", lead: `${s.levels.waiting} reading level${s.levels.waiting === 1 ? "" : "s"} waiting for your approval`, detail: `“${shortTitle(s.title, 60)}” · written for other ages, not yet shown to readers`, href: `/editorial/${s.id}`, cta: "Review levels", remove: { kind: "levels", storyId: s.id, count: s.levels.waiting } });
  }
  const reviewing = all.filter((s) => s.status === "draft" && s.provenance);
  for (const s of reviewing.slice(0, 2)) {
    todos.push({ tone: "warn", kind: "Draft", lead: "A draft is waiting for your review", detail: `“${shortTitle(s.title)}” · drafted from ${s.provenance?.title ? `“${shortTitle(s.provenance.title, 50)}”` : "your paper"} · ${timeAgo(s.updatedAt)}`, href: `/editorial/${s.id}`, cta: "Review", remove: { kind: "story", storyId: s.id, title: s.title } });
  }
  const readyNotDrafted = draftable.filter((p) => !all.some((s) => s.provenance?.sourceId === p.id)).slice(0, 1);
  for (const p of readyNotDrafted) {
    todos.push({ tone: "info", kind: "A paper", lead: "A paper is ready to draft from", detail: `“${shortTitle(p.title)}”${p.year ? ` (${p.year})` : ""} · ${Number(p.words || 0).toLocaleString()} words · ${p.reason}`, href: `/editorial/new?source=${encodeURIComponent(`${p.origin}:${p.id}`)}`, cta: "Start a story", spark: true });
  }
  const pending = (inventory?.unusable || []).filter((s) => s.pending).slice(0, 1);
  for (const p of pending) {
    todos.push({ tone: "faint", kind: "Upload", lead: "Your upload is being checked", detail: `“${shortTitle(p.title)}” · ${p.reason}`, href: "/papers", cta: "Track" });
  }
  todos.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);

  const [next, ...rest] = todos;
  const published = all.filter((s) => s.status === "published").length;
  const inReview = reviewing.length;

  return (
    <div className="st-page">
      <div className="st-main">
        {/* ── 1 · What to do now ───────────────────────────────────────── */}
        <section aria-labelledby="st-next-title">
        <article className={`st-next${next ? ` is-${next.tone}` : " is-clear"}`}>
          <p className="st-next__date">{today()}</p>
          <p className="st-next__greet">{greeting()}, {firstName}</p>
          <div className="st-next__main">
            <div className="st-next__copy">

          {next ? (
            <>
              <div className="st-next__tagrow">
                <span className={`st-next__eyebrow${next.tone === "grave" ? " is-grave" : ""}`}>
                  <HiOutlineSparkles size={13} aria-hidden />
                  Next
                </span>
                <span className={`st-next__chip is-${next.tone}`}>{next.kind}</span>
              </div>
              <h1 id="st-next-title" className="st-next__title">{next.lead}</h1>
              <p className="st-next__detail">{next.detail}</p>
              <div className="st-next__actions">
                <Link href={next.href} className="st-btn-xl">
                  {next.cta}
                  <HiOutlineArrowRight size={15} aria-hidden />
                </Link>
                {rest.length ? (
                  <a href="#st-queue" className="st-btn-xl is-quiet">See everything waiting</a>
                ) : null}
                <RemoveAction remove={next.remove} />
              </div>
              <p className="st-next__note">
                {rest.length
                  ? `${rest.length === 1 ? "One more thing is" : `${rest.length} more things are`} waiting below.`
                  : "Nothing else is waiting on you."}
              </p>
            </>
          ) : (
            <>
              <div className="st-next__tagrow">
                <span className="st-next__eyebrow">
                  <HiOutlineSparkles size={13} aria-hidden />
                  All clear
                </span>
              </div>
              <h1 id="st-next-title" className="st-next__title">Nothing is waiting on you</h1>
              <p className="st-next__detail">
                {counts.draftable > 0
                  ? `${counts.draftable} of your papers can be built on. A story is one click from any of them.`
                  : "When a paper you hold the rights to lands here, you can draft from it."}
              </p>
              <div className="st-next__actions">
                <Link href={counts.draftable > 0 ? "/editorial/new" : "/papers"} className="st-btn-xl">
                  {counts.draftable > 0 ? "Start a story" : "See your papers"}
                  <HiOutlineArrowRight size={15} aria-hidden />
                </Link>
              </div>
            </>
          )}
            </div>

            {/* The reference fills this half with a progress ring. A scholar
                has no percentage to show, but they do have a pipeline, and it
                is the same question: how is the work moving? */}
            <div className="st-pipe" aria-label="Where your work stands">
              {[
                { n: counts.draftable, label: counts.draftable === 1 ? "paper ready to draft" : "papers ready to draft", href: "/papers" },
                { n: inReview, label: inReview === 1 ? "draft in review" : "drafts in review", href: "/editorial", warn: inReview > 0 },
                { n: published, label: published === 1 ? "story published" : "stories published", href: "/editorial" },
              ].map((step, i) => (
                <Link key={step.label} href={step.href} className={`st-pipe__step${step.warn ? " is-warn" : ""}${i === 2 ? " is-last" : ""}`}>
                  <span className="st-pipe__n">{step.n}</span>
                  <span className="st-pipe__label">{step.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </article>
        </section>

        {/* ── 2 · The detail ───────────────────────────────────── */}
          {rest.length ? (
            <section className="st-card" id="st-queue" aria-labelledby="st-queue-title">
              <div className="st-card-head">
                <h2 id="st-queue-title" className="st-h2">Also waiting</h2>
                <span className="st-todo-detail">{rest.length} item{rest.length === 1 ? "" : "s"}</span>
              </div>
              <div className="st-todos">
                {rest.map((t, i) => (
                  <div key={i} className={`st-todo is-${t.tone}`}>
                    <span className={`st-dot is-${t.tone}`} aria-hidden />
                    <div className="st-todo-body">
                      <span className="st-todo-lead">{t.lead}</span>
                      <div className="st-todo-detail">{t.detail}</div>
                    </div>
                    <RemoveAction remove={t.remove} />
                    <Link href={t.href} className={t.tone === "grave" ? "sc-write-secondary st-btn-primary" : "sc-write-secondary st-btn"}>
                      {t.cta}
                    </Link>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="st-card" aria-labelledby="st-stories-title">
            <div className="st-card-head">
              <h2 id="st-stories-title" className="st-h2">Your stories</h2>
              <Link href="/editorial" className="st-link">All stories <HiOutlineArrowRight size={12} aria-hidden /></Link>
            </div>
            {all.length === 0 ? (
              <p className="st-muted">No stories yet. The first one is a paper and a click away.</p>
            ) : (
              all.slice(0, 6).map((s) => (
                <div key={s.id} className="st-story">
                  <div className="st-story-main">
                    <Link href={`/editorial/${s.id}`} className="st-story-title">{s.title || "Untitled story"}</Link>
                    <div className="st-todo-detail">
                      {s.status === "published" ? `Published ${formatDate(s.publishedAt || s.updatedAt)}` : s.status === "scheduled" ? `Scheduled for ${formatDate(s.scheduledFor)}` : `Draft · ${timeAgo(s.updatedAt)}`}
                      {s.provenance?.title ? ` · drawn from “${shortTitle(s.provenance.title, 48)}”` : " · written by hand"}
                    </div>
                  </div>
                  <span className="st-story-actions">
                    <span className={`sc-status is-${s.status === "draft" && s.provenance ? "draft" : s.status}`}>
                      {s.status === "draft" && s.provenance ? "In review" : s.status === "draft" ? "Draft" : s.status === "scheduled" ? "Scheduled" : "Published"}
                    </span>
                    <DeleteStoryButton storyId={s.id} title={s.title} compact />
                  </span>
                </div>
              ))
            )}
          </section>
      </div>

      {/* ── 3 · The rail, the length of the page ─────────────────── */}
      <aside className="st-rail">
        <section className="st-card">
          <span className="sc-kicker">Your papers</span>
          <p className="st-rail__big">
            <b>{counts.draftable}</b> {counts.draftable === 1 ? "paper is ready to draft from" : "papers are ready to draft from"}
          </p>
          <div className="st-shape__links">
            <Link href="/papers" className="st-link">All papers <HiOutlineArrowRight size={12} aria-hidden /></Link>
            <a href={DOCS_PORTAL_URL} target="_blank" rel="noreferrer" className="st-link">
              <HiOutlineArrowUpTray size={12} aria-hidden /> Add a paper
            </a>
          </div>
          {counts.citable > 0 && counts.draftable > 0 ? (
            <p className="st-shape__note">
              {counts.citable} of your papers can be quoted but not built on. Adding a version you hold the rights to changes that.
            </p>
          ) : inventory?.nudge ? (
            <p className="st-shape__note">{inventory.nudge}</p>
          ) : null}
        </section>
        <section className="st-card">
          <span className="sc-kicker">Profile</span>
          <div className="st-profile-name">{me.name}</div>
          {me.institution ? <div className="st-todo-detail">{me.institution}</div> : null}
          <div className="st-actions" style={{ marginTop: 12 }}>
            <Link href="/profile" className="st-link">Your record</Link>
            <Link href="/content" className="st-link">What Archivyn says about you</Link>
          </div>
        </section>
      </aside>
    </div>
  );
}
