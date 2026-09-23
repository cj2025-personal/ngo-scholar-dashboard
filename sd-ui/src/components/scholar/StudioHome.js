import Link from "next/link";
import { HiOutlineArrowRight, HiOutlineArrowUpTray } from "react-icons/hi2";

import DeleteStoryButton from "@/components/editorial/DeleteStoryButton";
import WaitingQueue from "@/components/scholar/WaitingQueue";

/**
 * Studio: what is waiting on you, then what you have written.
 *
 * ── Why it is arranged this way ────────────────────────────────────────────
 * In the order the eye takes them:
 *
 *   1. The date and the greeting, as a heading rather than a card. They say
 *      where you are, and that is all they are for.
 *   2. What is waiting, ranked by how much it matters — so a paper withdrawn
 *      from the scientific record is the first row and an upload still being
 *      scanned is the last. Tone is what does that ranking, not size.
 *   3. Your stories, and the rail.
 *
 * There used to be a fourth thing, at the top and taller than any of these:
 * the head of the queue promoted into a headline with its own buttons, beside
 * four counts of the work. It was removed because it restated the list below
 * it — the same item, the same action, one screen higher — and the counts it
 * sat next to were the rail's, printed twice. Rank alone is enough to say
 * what to deal with first.
 *
 * ── Tone is load-bearing ──────────────────────────────────────────────────
 * `grave` is for the two states where the right response might be to stop
 * something going out, or pull it back: the record moving under a published
 * claim, and a generated conversation that speaks as the scholar with turns
 * nothing of theirs supports. Both are about a real person's name on a claim
 * they did not make. Nothing else on this page is red.
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

/**
 * What a story's reads say, in a phrase.
 *
 * "Reads", never "readers": the count is of readings recorded by a browser
 * that stayed with the article, and the same person on two days counts twice.
 * The data to tell readers apart was deliberately never collected, so the
 * word that would imply otherwise is not available to this line.
 */
function readsLine({ total, recent }) {
  if (!total) return "not read yet";
  const all = `${total.toLocaleString()} read${total === 1 ? "" : "s"}`;
  /* The trailing week only when it is not simply the whole story again. */
  return recent && recent < total ? `${all} · ${recent.toLocaleString()} this week` : all;
}

function shortTitle(title, max = 70) {
  const t = String(title || "");
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export default function StudioHome({ me, sources, jobs, stories, episodes }) {
  const firstName = (me.name || "").split(/\s+/)[0] || "there";
  const inventory = sources || null;
  const draftable = inventory?.draftable || [];
  const counts = inventory?.counts || { draftable: 0, citable: 0, pending: 0 };
  const all = stories || [];
  /* Carried on the drafting inventory, so the rail costs no extra request. */
  const standing = inventory?.standing || null;

  /* What needs the scholar. Built in any order; ranked by tone below. */
  const todos = [];
  for (const job of jobs || []) {
    if (job.status === "awaiting_outline") {
      todos.push({ tone: "warn", kind: "Outline", group: "outline", lead: "An outline is waiting for your approval", title: shortTitle(job.outline?.title || job.source?.title), meta: `${job.outline?.beats?.length || 0} sections proposed · ${timeAgo(job.createdAt)}`, detail: `“${shortTitle(job.outline?.title || job.source?.title)}” · ${job.outline?.beats?.length || 0} sections proposed · ${timeAgo(job.createdAt)}`, href: `/editorial/new?job=${job.id}`, cta: "Review outline", remove: { kind: "job", jobId: job.id } });
    } else if (job.status === "awaiting_review" && !job.storyId) {
      todos.push({ tone: "warn", kind: "Draft", group: "job-draft", lead: "A draft is waiting for you", title: shortTitle(job.source?.title), meta: `Drafted from your paper · ${timeAgo(job.finishedAt)}`, detail: `From “${shortTitle(job.source?.title)}” · ${timeAgo(job.finishedAt)}`, href: `/editorial/new?job=${job.id}`, cta: "Open", remove: { kind: "job", jobId: job.id } });
    } else if (job.status === "running" || job.status === "queued") {
      todos.push({ tone: "info", kind: "In progress", group: "running", lead: "A draft is being written", title: shortTitle(job.source?.title), meta: `Started ${timeAgo(job.createdAt)}`, detail: `From “${shortTitle(job.source?.title)}” · started ${timeAgo(job.createdAt)}`, href: `/editorial/new?job=${job.id}`, /* A job still running cannot be discarded; one still queued can. */
        cta: "Watch", remove: job.status === "queued" ? { kind: "job", jobId: job.id } : null });
    }
  }
  /* The record moved against a source. Before anything else, always. */
  for (const s of all.filter((st) => st.record?.alerts && !st.record.acknowledgedAt)) {
    todos.push({ tone: "grave", kind: "The record", group: "record", lead: `The paper behind “${shortTitle(s.title, 50)}” has changed on the record`, title: shortTitle(s.title, 60), meta: s.record.headline, detail: s.record.headline, href: `/editorial/${s.id}`, cta: "Deal with it", remove: { kind: "story", storyId: s.id, title: s.title } });
  }
  for (const s of all.filter((st) => st.levels?.waiting > 0)) {
    todos.push({ tone: "warn", kind: "Reading ages", group: "levels", lead: `${s.levels.waiting} reading level${s.levels.waiting === 1 ? "" : "s"} waiting for your approval`, title: shortTitle(s.title, 60), meta: `${s.levels.waiting} level${s.levels.waiting === 1 ? "" : "s"} written for other ages, not yet shown to readers`, detail: `“${shortTitle(s.title, 60)}” · written for other ages, not yet shown to readers`, href: `/editorial/${s.id}`, cta: "Review levels", remove: { kind: "levels", storyId: s.id, count: s.levels.waiting } });
  }
  const reviewing = all.filter((s) => s.status === "draft" && s.provenance);
  /* All of them. This used to take the first two, which meant a scholar with
     seven drafts in review saw two and had no way to reach the other five
     from here — the count in the rail said seven and the list showed a pair.
     A draft waiting on a decision is an obligation, and the list of
     obligations is not somewhere to sample from. What keeps the card short is
     the display cap in WaitingQueue, which hides nothing permanently. */
  for (const s of reviewing) {
    todos.push({ tone: "warn", kind: "Draft", group: "review", lead: "A draft is waiting for your review", title: shortTitle(s.title, 64), meta: `Drafted from ${s.provenance?.title ? `“${shortTitle(s.provenance.title, 44)}”` : "your paper"} · ${timeAgo(s.updatedAt)}`, detail: `“${shortTitle(s.title)}” · drafted from ${s.provenance?.title ? `“${shortTitle(s.provenance.title, 50)}”` : "your paper"} · ${timeAgo(s.updatedAt)}`, href: `/editorial/${s.id}`, cta: "Review", remove: { kind: "story", storyId: s.id, title: s.title } });
  }
  /* One, deliberately, and unlike the drafts above this cap stays. A paper
     you could write about is an invitation, not a thing waiting on you, and a
     scholar with forty of them does not have forty items outstanding. The
     rail carries the full count; this row carries the suggestion. */
  const readyNotDrafted = draftable.filter((p) => !all.some((s) => s.provenance?.sourceId === p.id)).slice(0, 1);
  for (const p of readyNotDrafted) {
    /* It used to say a paper was *ready* — a fact about its licence, not a
       reason to write today — and offer a blank conversation. It now names
       the paper and offers to bring back an angle for it, because the thing
       a scholar is short of here is the framing, not the permission. */
    todos.push({
      tone: "info",
      kind: "A paper",
      lead: `“${shortTitle(p.title, 64)}” could become an article`,
      detail: `${p.year ? `${p.year} · ` : ""}${Number(p.words || 0).toLocaleString()} words · ${p.reason}. The agent can read it and propose one, or you can say what it should be.`,
      href: `/editorial/new?source=${encodeURIComponent(`${p.origin}:${p.id}`)}`,
      cta: "I'll say what to write",
      propose: { origin: p.origin, sourceId: p.id },
      spark: true,
    });
  }
  /* A conversation generated in the scholar's name that has not been released.
     This outranks the drafting rows and sits with the record alerts for the
     same reason: it is speech attributed to a living person, it goes out
     whether or not they look, and once it is published the thing a listener
     heard cannot be unheard. A turn of theirs citing nothing makes it grave;
     otherwise it is a warning. */
  for (const ep of (episodes || []).filter((e) => e.state === "pending")) {
    const bare = ep.voice?.myTurnsWithoutEvidence || 0;
    todos.push({
      tone: bare > 0 ? "grave" : "warn",
      kind: "Podcast",
      group: "episode",
      lead: bare > 0
        ? `A conversation speaks as you with ${bare} unsourced ${bare === 1 ? "turn" : "turns"}`
        : "A conversation in your name has not been released yet",
      title: shortTitle(ep.title, 64),
      meta: `With ${ep.with?.name || "the archive"} · ${ep.voice?.myTurns || 0} of ${ep.voice?.turns || 0} turns spoken as you`,
      detail: `“${shortTitle(ep.title, 60)}” · with ${ep.with?.name || "the archive"} · ${ep.voice?.myTurns || 0} of ${ep.voice?.turns || 0} turns spoken as you`,
      href: `/podcasts/${ep.id}`,
      cta: "Read it",
    });
  }
  /* One mark short of Legacy, and only then.
     `nextStep` is the standing engine's own answer to "what is left", so the
     queue cannot drift from the Where you stand page — there is one
     definition and both read it. Two marks short is not a queue row: that is
     a conversation the standing page has room for and this list does not.

     `info`, never `warn`. Nothing is waiting on the scholar here and nothing
     goes wrong if they ignore it; it sorts below every real obligation for
     that reason. It is also absent once Legacy is held, grandfathered
     included — a scholar who already has the thing has no mark to finish. */
  if (standing?.standing === "approaching" && standing.nextStep) {
    todos.push({
      tone: "info",
      kind: "Legacy",
      lead: `One mark left before Legacy: ${standing.nextStep.title.toLowerCase()}`,
      title: standing.nextStep.title,
      meta: standing.nextStep.blockers.join(" · "),
      detail: standing.nextStep.blockers.join(" · "),
      href: "/standing",
      cta: "Where you stand",
    });
  }

  const pending = (inventory?.unusable || []).filter((s) => s.pending).slice(0, 1);
  for (const p of pending) {
    todos.push({ tone: "faint", kind: "Upload", lead: "Your upload is being checked", detail: `“${shortTitle(p.title)}” · ${p.reason}`, href: "/papers", cta: "Track" });
  }
  todos.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);

  const published = all.filter((s) => s.status === "published").length;
  /* The end of the loop. Publishing is where this product used to stop
     talking: a scholar wrote the article, put their name on it, and the
     portal went quiet. Nothing in a scholar's career rewards this work, so
     the reach of it is the only thing the product has to offer back, and
     until it could count a read it was offering nothing. */
  const readsTotal = all.reduce((sum, s) => sum + (s.reads?.total || 0), 0);
  const readsRecent = all.reduce((sum, s) => sum + (s.reads?.recent || 0), 0);

  return (
    <div className="st-page">
      <div className="st-main">
        {/* ── 1 · Who and when ─────────────────────────────────────────── */}
        {/* Not a card. The date and the greeting are orientation, not work,
            and the hero that used to carry them was carrying a great deal
            else: the head of the queue promoted to a headline, its buttons,
            a count of what it had pushed below it, and four figures repeating
            what the rail already says. It cost the top third of the screen to
            restate the list underneath it. The list is now the page. */}
        <header className="st-hello">
          <p className="st-hello__date">{today()}</p>
          <h1 className="st-hello__greet">{greeting()}, {firstName}</h1>
        </header>

        {/* ── 2 · What is waiting ────────────────────────────── */}
        {todos.length ? (
          <WaitingQueue todos={todos} />
        ) : (
          <section className="st-card" aria-labelledby="st-queue-title">
            <div className="st-card-head">
              <h2 id="st-queue-title" className="st-h2">Waiting on you</h2>
            </div>
            <div className="st-clear">
              <p className="st-clear__lead">Nothing is waiting on you.</p>
              <p className="st-muted">
                {counts.draftable > 0
                  ? `${counts.draftable} of your papers can be built on. A story is one click from any of them.`
                  : "When a paper you hold the rights to lands here, you can draft from it."}
              </p>
              <div className="st-actions">
                <Link href={counts.draftable > 0 ? "/editorial/new" : "/papers"} className="sc-write-secondary st-btn-primary">
                  {counts.draftable > 0 ? "Start a story" : "See your papers"}
                  <HiOutlineArrowRight size={13} aria-hidden />
                </Link>
              </div>
            </div>
          </section>
        )}

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
                      {/* What came of it. Only a published story carries this,
                          and a published story with none says so rather than
                          leaving the line off — "no one yet" is an answer, and
                          the silence it replaces was the whole complaint. */}
                      {s.reads ? ` · ${readsLine(s.reads)}` : ""}
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
        {/* Reach. Only once there is something published to have reach, and
            deliberately plain about what the number is not: a count of
            readings, not of people, because nothing that could tell one
            reader from another was ever collected. */}
        {published > 0 ? (
          <section className="st-card">
            <span className="sc-kicker">Reach</span>
            <p className="st-rail__big">
              <b>{readsTotal.toLocaleString()}</b> {readsTotal === 1 ? "read of your published work" : "reads of your published work"}
            </p>
            {/* The trailing week only when it says something the line above
                did not. All of them being recent is the common case early on,
                and printing the same number twice is noise dressed as detail. */}
            {readsTotal > 0 && readsRecent < readsTotal ? (
              <p className="st-todo-detail">
                {readsRecent > 0 ? `${readsRecent.toLocaleString()} in the last seven days.` : "None in the last seven days."}
              </p>
            ) : null}
            <p className="st-shape__note">
              Reads, not readers: someone who comes back on another day is counted again.
              Nothing that would tell one reader from another is recorded.
            </p>
          </section>
        ) : null}
        {/* Where they stand against the Legacy benchmark. Always shown, met or
            not: a benchmark a scholar cannot see is a verdict, and the one
            thing this card must never be is the first time someone learns
            that a feature was closed to them. */}
        {standing ? (
          <section className="st-card">
            <span className="sc-kicker">Legacy</span>
            <p className="st-rail__big">
              <b>{standing.met}</b> of {standing.total} marks met
            </p>
            {standing.standing === "legacy" ? (
              <p className="st-todo-detail">
                {standing.grandfathered
                  ? "You hold Legacy. The marks show what the benchmark now asks."
                  : "You have met the benchmark. Drafting from your research is open."}
              </p>
            ) : standing.nextStep ? (
              <p className="st-todo-detail">One mark left: {standing.nextStep.title}.</p>
            ) : (
              <p className="st-todo-detail">Legacy opens drafting from your own research.</p>
            )}
            <div className="st-shape__links">
              <Link href="/standing" className="st-link">
                Where you stand <HiOutlineArrowRight size={12} aria-hidden />
              </Link>
            </div>
          </section>
        ) : null}

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
