import Link from "next/link";
import { HiOutlineArrowRight, HiOutlineArrowUpTray, HiOutlineCheck } from "react-icons/hi2";

import Kivyn from "@/components/kivyn/Kivyn";
import WriteWithKivyn from "@/components/kivyn/WriteWithKivyn";
import StoriesTable from "@/components/scholar/StoriesTable";
import WaitingQueue, { QueueClear } from "@/components/scholar/WaitingQueue";
import { buildStoryRows } from "@/lib/storyRows";
import { AGENT_NAME } from "@/lib/kivyn/pose.mjs";

/**
 * Studio: the scholar's dashboard.
 *
 * ── What is on it, in the order the eye takes it ───────────────────────────
 *   1. Five numbers in one slim strip: what needs you, papers you can draft
 *      from, what is published, reads, and Legacy. The space goes to the work.
 *   2. Pick up where you left off — the ranked queue, as rows to act on, with
 *      the papers you could start from under it — beside your papers and
 *      Legacy, each in a few lines. On a laptop this is what shows without
 *      scrolling.
 *   3. The pipeline beside reads over time, then your stories as a table.
 *
 * Writing starts from one door, "Write a story with Kivyn". Here it is a
 * nudge at the head of the page, beside the greeting, and the bar leaves
 * its own copy out; on every other page it is in the bar. Who you are is the
 * bar's account menu and Profile, so this page does not repeat that either.
 *
 * Every figure is one the page already loads — jobs, stories, the drafting
 * inventory and its standing, and reads by day — drawn rather than written
 * out as sentences. Nothing is estimated and nothing is decoration.
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
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return formatDate(value);
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function today() {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date());
}

/** A day of the reads series ("2026-09-18", UTC) as "Sep 18". */
function dayLabel(day) {
  const d = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(d);
}

function shortTitle(title, max = 70) {
  const t = String(title || "");
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/* ── What needs the scholar ────────────────────────────────────────────────
   Built in any order; ranked by tone. Each row is one thing with its way out. */
function buildTodos({ jobs, all, draftable, episodes, standing, inventory }) {
  const todos = [];
  for (const job of jobs || []) {
    if (job.status === "awaiting_outline") {
      todos.push({ tone: "warn", kind: "Outline", group: "outline", lead: "An outline is waiting for your approval", title: shortTitle(job.outline?.title || job.source?.title), meta: `${job.outline?.beats?.length || 0} sections proposed · ${timeAgo(job.createdAt)}`, detail: `“${shortTitle(job.outline?.title || job.source?.title)}” · ${job.outline?.beats?.length || 0} sections proposed · ${timeAgo(job.createdAt)}`, href: `/editorial/new?job=${job.id}`, cta: "Review outline", remove: { kind: "job", jobId: job.id } });
    } else if (job.status === "awaiting_review" && !job.storyId) {
      todos.push({ tone: "warn", kind: "Draft", group: "job-draft", lead: "A draft is waiting for you", title: shortTitle(job.source?.title), meta: `Drafted from your paper · ${timeAgo(job.finishedAt)}`, detail: `From “${shortTitle(job.source?.title)}” · ${timeAgo(job.finishedAt)}`, href: `/editorial/new?job=${job.id}`, cta: "Open", remove: { kind: "job", jobId: job.id } });
    } else if (job.status === "running" || job.status === "queued") {
      /* A job still running cannot be discarded; one still queued can. */
      todos.push({ tone: "info", kind: "In progress", group: "running", lead: "A draft is being written", title: shortTitle(job.source?.title), meta: `Started ${timeAgo(job.createdAt)}`, detail: `From “${shortTitle(job.source?.title)}” · started ${timeAgo(job.createdAt)}`, href: `/editorial/new?job=${job.id}`, cta: "Watch", remove: job.status === "queued" ? { kind: "job", jobId: job.id } : null });
    }
  }
  /* The record moved against a source. Before anything else, always. */
  for (const s of all.filter((st) => st.record?.alerts && !st.record.acknowledgedAt)) {
    todos.push({ tone: "grave", kind: "The record", group: "record", lead: `The paper behind “${shortTitle(s.title, 50)}” has changed on the record`, title: shortTitle(s.title, 60), meta: s.record.headline, detail: s.record.headline, href: `/editorial/${s.id}`, cta: "Deal with it", remove: { kind: "story", storyId: s.id, title: s.title } });
  }
  for (const s of all.filter((st) => st.levels?.waiting > 0)) {
    todos.push({ tone: "warn", kind: "Reading ages", group: "levels", lead: `${s.levels.waiting} reading level${s.levels.waiting === 1 ? "" : "s"} waiting for your approval`, title: shortTitle(s.title, 60), meta: `${s.levels.waiting} level${s.levels.waiting === 1 ? "" : "s"} written for other ages, not yet shown to readers`, detail: `“${shortTitle(s.title, 60)}” · written for other ages, not yet shown to readers`, href: `/editorial/${s.id}`, cta: "Review levels", remove: { kind: "levels", storyId: s.id, count: s.levels.waiting } });
  }
  /* Every draft in review: a draft waiting on a decision is an obligation,
     and the list of obligations is not somewhere to sample from. The display
     cap in the queue keeps the card short and hides nothing permanently. */
  for (const s of all.filter((st) => st.status === "draft" && st.provenance)) {
    todos.push({ tone: "warn", kind: "Draft", group: "review", lead: "A draft is waiting for your review", title: shortTitle(s.title, 64), meta: `Drafted from ${s.provenance?.title ? `“${shortTitle(s.provenance.title, 44)}”` : s.provenance?.origin === "brief" ? "your brief" : "your paper"} · ${timeAgo(s.updatedAt)}`, detail: `“${shortTitle(s.title)}” · drafted from ${s.provenance?.title ? `“${shortTitle(s.provenance.title, 50)}”` : s.provenance?.origin === "brief" ? "your brief, no paper" : "your paper"} · ${timeAgo(s.updatedAt)}`, href: `/editorial/${s.id}`, cta: "Review", remove: { kind: "story", storyId: s.id, title: s.title } });
  }
  /* One paper not yet drafted, as an invitation rather than an obligation. */
  for (const p of draftable.filter((d) => !all.some((s) => s.provenance?.sourceId === d.id)).slice(0, 1)) {
    todos.push({
      tone: "info",
      kind: "A paper",
      lead: `“${shortTitle(p.title, 64)}” could become an article`,
      detail: `${p.year ? `${p.year} · ` : ""}${Number(p.words || 0).toLocaleString()} words · ${p.reason}. ${AGENT_NAME} can read it and propose one, or you can say what it should be.`,
      href: `/editorial/new?source=${encodeURIComponent(`${p.origin}:${p.id}`)}`,
      cta: "I'll say what to write",
      propose: { origin: p.origin, sourceId: p.id },
    });
  }
  /* A conversation generated in the scholar's name, not yet released: speech
     attributed to a living person. Grave when a turn of theirs cites nothing. */
  for (const ep of (episodes || []).filter((e) => e.state === "pending")) {
    const bare = ep.voice?.myTurnsWithoutEvidence || 0;
    todos.push({
      tone: bare > 0 ? "grave" : "warn",
      kind: "Podcast",
      group: "episode",
      lead: bare > 0 ? `A conversation speaks as you with ${bare} unsourced ${bare === 1 ? "turn" : "turns"}` : "A conversation in your name has not been released yet",
      title: shortTitle(ep.title, 64),
      meta: `With ${ep.with?.name || "the archive"} · ${ep.voice?.myTurns || 0} of ${ep.voice?.turns || 0} turns spoken as you`,
      detail: `“${shortTitle(ep.title, 60)}” · with ${ep.with?.name || "the archive"} · ${ep.voice?.myTurns || 0} of ${ep.voice?.turns || 0} turns spoken as you`,
      href: `/podcasts/${ep.id}`,
      cta: "Read it",
    });
  }
  /* One mark short of Legacy, and only then: the standing engine's own nextStep. */
  if (standing?.standing === "approaching" && standing.nextStep) {
    todos.push({ tone: "info", kind: "Legacy", lead: `One mark left before Legacy: ${standing.nextStep.title.toLowerCase()}`, title: standing.nextStep.title, meta: standing.nextStep.blockers.join(" · "), detail: standing.nextStep.blockers.join(" · "), href: "/standing", cta: "Where you stand" });
  }
  for (const p of (inventory?.unusable || []).filter((s) => s.pending).slice(0, 1)) {
    todos.push({ tone: "faint", kind: "Upload", lead: "Your upload is being checked", detail: `“${shortTitle(p.title)}” · ${p.reason}`, href: "/papers", cta: "Track" });
  }
  return todos.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);
}

/* The nouns for what is waiting. Reading levels are counted as levels, so the number is literally true. */
const KIND_NOUN = {
  "The record": ["record alert", "record alerts"],
  Podcast: ["conversation", "conversations"],
  Outline: ["outline", "outlines"],
  Draft: ["draft", "drafts"],
  "In progress": ["draft being written", "drafts being written"],
  "Reading ages": ["reading level", "reading levels"],
  "A paper": ["paper to draft", "papers to draft"],
  Legacy: ["Legacy mark", "Legacy marks"],
  Upload: ["upload", "uploads"],
};

function describeTodos(todos) {
  const kinds = [];
  for (const t of todos) {
    const n = t.kind === "Reading ages" ? t.remove?.count || 1 : 1;
    const found = kinds.find((k) => k.kind === t.kind);
    if (found) found.n += n;
    else kinds.push({ kind: t.kind, n });
  }
  const said = kinds.slice(0, 2).map(({ kind, n }) => {
    const [one, many] = KIND_NOUN[kind] || ["thing", "things"];
    return `${n.toLocaleString()} ${n === 1 ? one : many}`;
  });
  return kinds.length > 2 ? `${said.join(" · ")} · ${kinds.length - 2} more` : said.join(" · ");
}

/* ── Pictures of the numbers ─────────────────────────────────────────────── */

/** A ring: how far round a part of a whole is. */
function Ring({ part, whole, size = 40 }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  const share = whole > 0 ? Math.min(1, part / whole) : 0;
  return (
    <svg className="dash-ring" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r={r} className="dash-ring__track" />
      {share > 0 ? <circle cx="20" cy="20" r={r} className="dash-ring__arc" strokeDasharray={`${(share * c).toFixed(1)} ${c.toFixed(1)}`} transform="rotate(-90 20 20)" /> : null}
    </svg>
  );
}

/** A sparkline of bars: the last days of a series, the latest marked. */
function Spark({ series, days = 14 }) {
  const tail = series.slice(-days);
  const max = Math.max(1, ...tail.map((p) => p.reads));
  return (
    <span className="dash-spark" aria-hidden>
      {/* A day nobody read is a stub, not a bar scaled to look like something. */}
      {tail.map((p, i) => (
        <i key={p.day} className={i === tail.length - 1 ? "is-today" : undefined} style={p.reads ? { height: `${Math.max(12, Math.round((p.reads / max) * 100))}%` } : undefined} />
      ))}
    </span>
  );
}

/* ── Reads, day by day ───────────────────────────────────────────────────── */

function ReadsCard({ reads, range, ranges, publishedCount }) {
  const series = reads?.series || [];
  const max = Math.max(1, ...series.map((p) => p.reads));
  const diff = reads ? reads.total - reads.previousTotal : 0;
  const nothingOut = publishedCount === 0 && !(reads?.published > 0);
  return (
    <section className="st-card dash-card dash-reads-card" id="dash-reads" aria-labelledby="dash-reads-title">
      <div className="dash-card__head">
        <h2 id="dash-reads-title" className="dash-h2">Reads</h2>
        <nav className="dash-seg" aria-label="Reads over">
          {ranges.map((d) => (
            <Link key={d} href={d === 30 ? "/" : `/?range=${d}`} scroll={false} className={d === range ? "dash-seg__opt on" : "dash-seg__opt"} aria-current={d === range ? "true" : undefined}>
              {d}d
            </Link>
          ))}
        </nav>
      </div>
      {nothingOut ? (
        <div className="dash-reads-empty">
          <p className="dash-clear__lead">Reads show here once a story is published.</p>
          <p className="dash-muted">A read is counted when someone stays with the article, not when the page loads.</p>
        </div>
      ) : !reads ? (
        <p className="dash-muted dash-reads-empty">Reads could not be loaded just now.</p>
      ) : (
        <>
          <div className="dash-reads-total">
            <span className="dash-metric">{reads.total.toLocaleString()}</span>
            <span className={`dash-delta${diff > 0 ? " is-up" : diff < 0 ? " is-down" : ""}`}>
              {diff === 0 ? `Same as the ${range} days before` : `${diff > 0 ? "+" : "−"}${Math.abs(diff).toLocaleString()} vs the ${range} days before`}
            </span>
          </div>
          <div className="dash-chart" data-n={series.length} role="img" aria-label={`${plural(reads.total, "read")} over the last ${range} days`}>
            {series.map((p, i) => (
              <span key={p.day} className={`dash-chart__bar${i === series.length - 1 ? " is-today" : ""}${p.reads ? "" : " is-zero"}`} title={`${dayLabel(p.day)} · ${plural(p.reads, "read")}`}>
                <i style={{ height: p.reads ? `${Math.max(6, Math.round((p.reads / max) * 100))}%` : undefined }} />
              </span>
            ))}
          </div>
          <div className="dash-chart__axis" aria-hidden>
            <span>{series.length ? dayLabel(series[0].day) : ""}</span>
            <span>Today</span>
          </div>
          {/* The one that drew the most, by name: the rest are in the table below. */}
          {reads.top?.length ? (
            <p className="dash-top">
              <span className="dash-top__label">Most read</span>
              <Link href={`/editorial/${reads.top[0].storyId}`} title={reads.top[0].title}>{reads.top[0].title}</Link>
              <b>{reads.top[0].reads.toLocaleString()}</b>
            </p>
          ) : (
            <p className="dash-top dash-faint">No reads in these {range} days.</p>
          )}
        </>
      )}
      <p className="dash-footnote">Reads, not readers: someone who comes back on another day is counted again.</p>
    </section>
  );
}

/* ── The pipeline ────────────────────────────────────────────────────────── */

function Pipeline({ stages }) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <section className="st-card dash-card dash-pipeline" aria-labelledby="dash-pipeline-title">
      <div className="dash-card__head">
        <h2 id="dash-pipeline-title" className="dash-h2">Your pipeline</h2>
        <span className="dash-muted">From a paper to a published story</span>
      </div>
      <ol className="dash-stages">
        {stages.map((s, i) => (
          <li key={s.key} className={`dash-stage${s.action && s.count > 0 ? " is-action" : ""}${s.count === 0 ? " is-empty" : ""}`}>
            <Link href={s.href} className="dash-stage__link">
              <span className="dash-stage__label"><em>{i + 1}</em>{s.label}</span>
              <span className="dash-stage__count">{s.count.toLocaleString()}</span>
              <span className="dash-stage__bar" aria-hidden><i style={{ width: `${s.count ? Math.max(6, Math.round((s.count / max) * 100)) : 0}%` }} /></span>
              <span className="dash-stage__hint">{s.hint}</span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ── The side column ─────────────────────────────────────────────────────── */

function LegacyCard({ standing }) {
  if (!standing) return null;
  const held = standing.standing === "legacy";
  return (
    <section className="st-card dash-card dash-side-card dash-legacy" aria-labelledby="dash-legacy-title">
      <Ring part={standing.met} whole={standing.total} size={44} />
      <div className="dash-legacy__body">
        <h3 id="dash-legacy-title" className="dash-h3">Legacy · {standing.met} of {standing.total} marks met</h3>
        <p className="dash-muted">
          {held
            ? standing.grandfathered
              ? "Held either way: you were named to Legacy before these marks existed."
              : "Every mark met. Drafting from your research is open."
            : standing.nextStep
              ? `One mark left: ${standing.nextStep.title}.`
              : "Legacy opens drafting from your own research."}
        </p>
        {standing.gates?.length ? (
          <ul className="dash-gates">
            {standing.gates.map((g) => (
              <li key={g.key} className={g.met ? "is-met" : ""} title={g.title}>
                <span className="dash-gate__mark" aria-hidden>{g.met ? <HiOutlineCheck size={11} /> : null}</span>
                <span>{g.title}</span>
                <span className="sr-only">{g.met ? "met" : "not met"}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <Link href="/standing" className="dash-link">Where you stand <HiOutlineArrowRight size={12} aria-hidden /></Link>
      </div>
    </section>
  );
}

function PapersCard({ counts, inventory }) {
  const parts = [
    { key: "ready", label: "ready to draft", n: counts.draftable || 0 },
    { key: "quote", label: "quotable only", n: counts.citable || 0 },
    { key: "check", label: "being checked", n: counts.pending || 0 },
  ];
  const sum = parts.reduce((a, p) => a + p.n, 0);
  return (
    <section className="st-card dash-card dash-side-card dash-papers" aria-labelledby="dash-papers-title">
      <div className="dash-card__head">
        <h3 id="dash-papers-title" className="dash-h3">Your papers</h3>
        <span className="dash-faint">{plural(sum, "paper")}</span>
      </div>
      <div className="dash-split" aria-hidden>
        {parts.filter((p) => p.n > 0).map((p) => <i key={p.key} className={`is-${p.key}`} style={{ flexGrow: p.n }} />)}
      </div>
      {/* Only what there is: "0 being checked" is not a thing to read. */}
      <ul className="dash-legend">
        {parts.filter((p) => p.n > 0 || p.key === "ready").map((p) => <li key={p.key}><i className={`is-${p.key}`} aria-hidden /><b>{p.n}</b> {p.label}</li>)}
      </ul>
      {counts.citable > 0 && counts.draftable > 0 ? null : inventory?.nudge ? <p className="dash-muted">{inventory.nudge}</p> : null}
      <div className="dash-links">
        <Link href="/papers" className="dash-link">All papers <HiOutlineArrowRight size={12} aria-hidden /></Link>
        <a href={DOCS_PORTAL_URL} target="_blank" rel="noreferrer" className="dash-link"><HiOutlineArrowUpTray size={12} aria-hidden /> Add a paper</a>
      </div>
    </section>
  );
}

/* ── The numbers, in one strip ───────────────────────────────────────────── */

/** One number: what is counted, the count, and what it means. The whole of it links to where it comes from. */
function Stat({ label, value, unit = null, sub = "", href, tone = "" }) {
  return (
    <Link href={href} className={`dash-stat${tone ? ` is-${tone}` : ""}`}>
      <span className="dash-stat__label">{label}</span>
      <span className="dash-stat__row">
        <span className="dash-stat__value">{value}{unit ? <small>{unit}</small> : null}</span>
        {sub ? <span className="dash-stat__sub">{sub}</span> : null}
      </span>
    </Link>
  );
}

/* ── First visit: nothing written yet ────────────────────────────────────── */

function FirstStory({ inventory, draftable }) {
  return (
    <section className="st-card dash-card dash-first" aria-labelledby="dash-first-title">
      <Kivyn pose="neutral" size={132} />
      <div className="dash-first__body">
        <h2 id="dash-first-title" className="dash-h2">Start your first story from one of your papers</h2>
        <p className="dash-muted">Choose a paper. {AGENT_NAME} plans the article, you approve the plan, and the draft lands in your editor with every paragraph tied to the passage it came from.</p>
        {!inventory?.eligible && inventory ? (
          <p className="dash-note">{inventory.gateReason || "Drafting from your papers is not open to you yet."}</p>
        ) : draftable.length ? (
          <ul className="dash-first__papers">
            {draftable.slice(0, 3).map((p) => (
              <li key={`${p.origin}:${p.id}`}>
                <span title={p.title}>{p.title}</span>
                <Link href={`/editorial/new?source=${encodeURIComponent(`${p.origin}:${p.id}`)}`} className="dash-link">Start <HiOutlineArrowRight size={12} aria-hidden /></Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="dash-note">{inventory?.nudge || "Nothing is ready to draft from yet. Add a paper you hold the rights to."}</p>
        )}
        {/* Writing without a paper is the nudge at the head of the page; this card only adds one. */}
        <div className="dash-links">
          <a href={DOCS_PORTAL_URL} target="_blank" rel="noreferrer" className="dash-btn"><HiOutlineArrowUpTray size={14} aria-hidden /> Add a paper</a>
        </div>
      </div>
    </section>
  );
}

/* ── The page ────────────────────────────────────────────────────────────── */

export default function StudioHome({ me, sources, jobs, stories, episodes, reads = null, range = 30, ranges = [7, 30, 90] }) {
  const firstName = (me.name || "").split(/\s+/)[0] || "there";
  const inventory = sources || null;
  const draftable = inventory?.draftable || [];
  const counts = inventory?.counts || { draftable: 0, citable: 0, pending: 0 };
  const all = stories || [];
  const standing = inventory?.standing || null;

  const todos = buildTodos({ jobs, all, draftable, episodes, standing, inventory });

  const published = all.filter((s) => s.status === "published");
  const scheduled = all.filter((s) => s.status === "scheduled");
  const inReview = all.filter((s) => s.status === "draft" && s.provenance);
  const outlines = (jobs || []).filter((j) => j.status === "awaiting_outline");
  const writing = (jobs || []).filter((j) => j.status === "running" || j.status === "queued");
  const draftsWaiting = (jobs || []).filter((j) => j.status === "awaiting_review" && !j.storyId);
  const readsTotal = all.reduce((sum, s) => sum + (s.reads?.total || 0), 0);
  const readsRecent = all.reduce((sum, s) => sum + (s.reads?.recent || 0), 0);
  /* First visit: nothing written and nothing waiting. A scholar with no stories
     can still have something that needs them, a conversation in their name not
     yet released above all, and the first-visit layout has no queue to show it
     in; so any obligation (grave or warn) means the full Studio. */
  const firstVisit = all.length === 0 && (jobs || []).length === 0 && !todos.some((t) => t.tone === "grave" || t.tone === "warn");

  /* What needs you, by tone, for the tile's bar; and in words, by kind. */
  const byTone = ["grave", "warn", "info", "faint"].map((tone) => ({ tone, n: todos.filter((t) => t.tone === tone).length })).filter((x) => x.n);
  /* What is waiting, by kind and in the queue's own order: "1 conversation · 2 drafts", never "2 other". */
  const needsSub = todos.length === 0 ? "You're all caught up" : describeTodos(todos);

  const stages = [
    { key: "papers", label: "Papers ready", count: counts.draftable || 0, href: "/papers", hint: "to draft from" },
    { key: "outline", label: "Outlines to approve", count: outlines.length, href: outlines.length === 1 ? `/editorial/new?job=${outlines[0].id}` : "/editorial", hint: outlines.length ? "waiting on you" : "none waiting", action: true },
    { key: "writing", label: "Being written", count: writing.length, href: writing.length === 1 ? `/editorial/new?job=${writing[0].id}` : "/editorial", hint: writing.length ? `${AGENT_NAME} is drafting` : "nothing drafting" },
    { key: "review", label: "In review", count: inReview.length + draftsWaiting.length, href: "/editorial?tab=review", hint: inReview.length + draftsWaiting.length ? "waiting on you" : "none waiting", action: true },
    /* Published means published, here as on the tile: what is scheduled is said beside it, not counted in it. */
    { key: "published", label: "Published", count: published.length, href: "/editorial?tab=published", hint: scheduled.length ? `+ ${scheduled.length} scheduled` : "live for readers" },
  ];

  const rows = buildStoryRows(all);
  /* The papers a story could start from, under the queue: the ones not yet written up first. */
  const written = (p) => Number(all.some((s) => s.provenance?.sourceId === p.id));
  const startable = [...draftable].sort((a, b) => written(a) - written(b)).slice(0, 3);

  return (
    <div className="dash">
      <header className="dash-head">
        <div>
          <p className="dash-date">{today()}</p>
          <h1 className="dash-greet">{firstVisit ? `Welcome to your Studio, ${firstName}` : `${greeting()}, ${firstName}`}</h1>
        </div>
        <WriteWithKivyn variant="nudge" />
      </header>

      <section className="st-card dash-stats" aria-label="At a glance">
        <Stat label="Needs you" value={todos.length.toLocaleString()} sub={needsSub} href="#st-queue" tone={todos.some((t) => t.tone === "grave") ? "grave" : todos.length ? "warn" : ""} />
        <Stat label="Papers ready" value={(counts.draftable || 0).toLocaleString()} sub={counts.pending ? `${counts.pending.toLocaleString()} being checked` : counts.citable ? `${counts.citable.toLocaleString()} quotable only` : "to draft from"} href="/papers" />
        <Stat label="Published" value={published.length.toLocaleString()} sub={`${scheduled.length} scheduled`} href="/editorial?tab=published" />
        <Stat label="Reads" value={readsTotal.toLocaleString()} sub={readsTotal ? `${readsRecent.toLocaleString()} this week` : published.length ? "not read yet" : "once a story is out"} href="#dash-reads" />
        <Stat label="Legacy" value={standing ? standing.met : "—"} unit={standing ? ` / ${standing.total}` : null} sub={!standing ? "unavailable" : standing.standing === "legacy" ? "marks met · held" : standing.nextStep ? "marks met · one left" : "marks met"} href="/standing" />
      </section>

      {firstVisit ? (
        <section className="dash-grid">
          <div className="dash-col-main"><FirstStory inventory={inventory} draftable={draftable} /></div>
          <aside className="dash-col-side st-rail">
            <PapersCard counts={counts} inventory={inventory} />
            <LegacyCard standing={standing} />
          </aside>
        </section>
      ) : (
        <>
          <section className="dash-grid is-top">
            <div className="dash-col-main">{todos.length ? <WaitingQueue todos={todos} papers={startable} /> : <QueueClear draftable={counts.draftable || 0} papers={startable} />}</div>
            <aside className="dash-col-side st-rail">
              <PapersCard counts={counts} inventory={inventory} />
              <LegacyCard standing={standing} />
            </aside>
          </section>

          <section className="dash-grid">
            <div className="dash-col-main"><Pipeline stages={stages} /></div>
            <div className="dash-col-side"><ReadsCard reads={reads} range={range} ranges={ranges} publishedCount={published.length + scheduled.length} /></div>
          </section>

          <StoriesTable rows={rows} total={all.length} />
        </>
      )}
    </div>
  );
}
