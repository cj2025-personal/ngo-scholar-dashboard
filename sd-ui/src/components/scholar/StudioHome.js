import Link from "next/link";
import { FaArrowRight, FaUpload, FaWandMagicSparkles } from "react-icons/fa6";

import DeleteStoryButton from "@/components/editorial/DeleteStoryButton";
import DiscardJobButton from "@/components/editorial/DiscardJobButton";

/**
 * Studio: what needs the scholar today, then their stories, then their papers.
 *
 * No composer bar and no zero-count widgets. Every row here is something a
 * person can act on, in one click, and the list is empty when there is
 * nothing to do — which is a fine state for a page to be in.
 */

const DOCS_PORTAL_URL =
  process.env.NEXT_PUBLIC_DOCS_PORTAL_URL || "http://localhost:3000/scholar-documents";

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

function shortTitle(title, max = 70) {
  const t = String(title || "");
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export default function StudioHome({ me, sources, jobs, stories }) {
  const firstName = (me.name || "").split(/\s+/)[0] || "there";
  const inventory = sources || null;
  const draftable = inventory?.draftable || [];
  const counts = inventory?.counts || { draftable: 0, citable: 0, pending: 0 };

  /* What needs the scholar, in priority order. */
  const todos = [];
  for (const job of jobs || []) {
    if (job.status === "awaiting_outline") {
      todos.push({ tone: "warn", lead: "An outline is waiting for your approval", detail: `“${shortTitle(job.outline?.title || job.source?.title)}” · ${job.outline?.beats?.length || 0} sections proposed · ${timeAgo(job.createdAt)}`, href: `/editorial/new?job=${job.id}`, cta: "Review outline", jobId: job.id });
    } else if (job.status === "awaiting_review" && !job.storyId) {
      todos.push({ tone: "warn", lead: "A draft is waiting for you", detail: `From “${shortTitle(job.source?.title)}” · ${timeAgo(job.finishedAt)}`, href: `/editorial/new`, cta: "Open", jobId: job.id });
    } else if (job.status === "running" || job.status === "queued") {
      todos.push({ tone: "navy", lead: "A draft is being written", detail: `From “${shortTitle(job.source?.title)}” · started ${timeAgo(job.createdAt)}`, href: `/editorial/new?job=${job.id}`, cta: "Watch", jobId: job.status === "queued" ? job.id : null });
    }
  }
  /* The record moved against a source: first, before anything else. */
  for (const s of (stories || []).filter((st) => st.record?.alerts && !st.record.acknowledgedAt)) {
    todos.push({ tone: "bad", lead: `The paper behind “${shortTitle(s.title, 50)}” has changed on the record`, detail: s.record.headline, href: `/editorial/${s.id}`, cta: "Deal with it" });
  }
  for (const s of (stories || []).filter((st) => st.levels?.waiting > 0)) {
    todos.push({ tone: "warn", lead: `${s.levels.waiting} reading level${s.levels.waiting === 1 ? "" : "s"} waiting for your approval`, detail: `“${shortTitle(s.title, 60)}” · written for other ages, not yet shown to readers`, href: `/editorial/${s.id}`, cta: "Review levels" });
  }
  const reviewing = (stories || []).filter((s) => s.status === "draft" && s.provenance);
  for (const s of reviewing.slice(0, 2)) {
    todos.push({ tone: "warn", lead: "A draft is waiting for your review", detail: `“${shortTitle(s.title)}” · drafted from ${s.provenance?.title ? `“${shortTitle(s.provenance.title, 50)}”` : "your paper"} · ${timeAgo(s.updatedAt)}`, href: `/editorial/${s.id}`, cta: "Review" });
  }
  const readyNotDrafted = draftable.filter((p) => !(stories || []).some((s) => s.provenance?.sourceId === p.id)).slice(0, 1);
  for (const p of readyNotDrafted) {
    todos.push({ tone: "navy", lead: "A paper is ready to draft from", detail: `“${shortTitle(p.title)}”${p.year ? ` (${p.year})` : ""} · ${Number(p.words || 0).toLocaleString()} words · ${p.reason}`, href: `/editorial/new?source=${encodeURIComponent(`${p.origin}:${p.id}`)}`, cta: "Start a story", icon: true });
  }
  const pending = (inventory?.unusable || []).filter((s) => s.pending).slice(0, 1);
  for (const p of pending) {
    todos.push({ tone: "faint", lead: "Your upload is being checked", detail: `“${shortTitle(p.title)}” · ${p.reason}`, href: "/papers", cta: "Track" });
  }

  return (
    <div className="st-wrap">
      <div className="st-main">
        <div>
          <span className="sc-kicker">Studio</span>
          <h1 className="st-h1">{greeting()}, {firstName}</h1>
          <p className="st-sub">
            {todos.length === 0
              ? "Nothing is waiting on you. Start a story from one of your papers whenever you like."
              : `${todos.length === 1 ? "One thing is" : `${todos.length} things are`} waiting on you. Everything else is where you left it.`}
          </p>
        </div>

        {todos.length ? (
          <div className="st-todos">
            {todos.map((t, i) => (
              <div key={i} className="st-todo">
                <span className={`st-dot is-${t.tone}`} aria-hidden />
                <div className="st-todo-body">
                  <span className="st-todo-lead">{t.lead}</span>
                  <div className="st-todo-detail">{t.detail}</div>
                </div>
                {t.jobId ? <DiscardJobButton jobId={t.jobId} /> : null}
                <Link href={t.href} className={t.tone === "warn" ? "sc-write-secondary st-btn-primary" : "sc-write-secondary st-btn"}>
                  {t.icon ? <FaWandMagicSparkles size={11} aria-hidden /> : null} {t.cta}
                </Link>
              </div>
            ))}
          </div>
        ) : null}

        <section className="st-card">
          <div className="st-card-head">
            <h2 className="st-h2">Your stories</h2>
            <Link href="/editorial" className="st-link">All stories <FaArrowRight size={11} aria-hidden /></Link>
          </div>
          {(stories || []).length === 0 ? (
            <p className="st-muted">No stories yet. The first one is a paper and a click away.</p>
          ) : (
            (stories || []).slice(0, 5).map((s) => (
              <div key={s.id} className="st-story">
                <div>
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

      <aside className="st-rail">
        <section className="st-card">
          <span className="sc-kicker">Your papers</span>
          <div className="st-stats">
            <div><div className="st-stat">{counts.draftable}</div><div className="st-stat-label">ready to draft from</div></div>
            <div><div className="st-stat is-info">{counts.citable}</div><div className="st-stat-label">quotable</div></div>
            <div><div className="st-stat is-faint">{counts.pending}</div><div className="st-stat-label">in progress</div></div>
          </div>
          {inventory?.nudge ? <p className="st-muted" style={{ marginTop: 12 }}>{inventory.nudge}</p> : counts.citable > 0 && counts.draftable === 0 ? null : null}
          {counts.citable > 0 && counts.draftable > 0 ? (
            <p className="st-muted" style={{ marginTop: 12 }}>
              {counts.citable} of your papers can be quoted but not built on. Adding a version you hold the rights to changes that.
            </p>
          ) : null}
          <div className="st-actions">
            <Link href="/papers" className="sc-write-secondary st-btn">See all papers</Link>
            <a href={DOCS_PORTAL_URL} target="_blank" rel="noreferrer" className="sc-write-secondary st-btn"><FaUpload size={11} aria-hidden /> Add a paper</a>
          </div>
        </section>

        <section className="st-card">
          <span className="sc-kicker">Profile</span>
          <div className="st-profile-name">{me.name}</div>
          {me.institution ? <div className="st-todo-detail">{me.institution}</div> : null}
          <div className="st-actions" style={{ marginTop: 10 }}>
            <Link href="/profile" className="st-link">Your record</Link>
            <Link href="/content" className="st-link">What Archivyn says about you</Link>
          </div>
        </section>
      </aside>
    </div>
  );
}
