"use client";

import { useCallback, useEffect, useState } from "react";
import { FaArrowUpRightFromSquare, FaBookOpen, FaWandMagicSparkles } from "react-icons/fa6";

import { DRAFT_AUDIENCES, getDraftSources } from "@/lib/drafting";

/**
 * "What I can draft from" — the panel that turns 4-of-65 into more.
 *
 * ── Why this ships before the agent ────────────────────────────────────────
 * Measured on 2026-09-11: of 65 Legacy scholars, four hold enough licensed
 * text for "Draft from my research" to run on. The rest can be cited but not
 * built on, because 3,398 of 3,757 harvested sources permit short quotes
 * only. Nothing changes that except the scholar handing us a paper they hold
 * the rights to — and nobody hands over a paper to a form with no reason on
 * it. This panel is the reason: it shows exactly what we hold, under what
 * terms, and the one thing that would change the answer.
 *
 * ── Why it links out to upload rather than hosting a form ──────────────────
 * The Scholar Documents portal already does uploads properly: browser-to-GCS
 * with signed URLs, magic-byte checks, a malware-scan gate, quotas, consent
 * versioning, a lease-based text extractor and an admin review queue. A second
 * upload path was built here and reverted the same day — it wrote a shape the
 * portal's model refuses. So this panel reads and points; it never writes.
 *
 * ── The Draft button ───────────────────────────────────────────────────────
 * Sits beside each source marked ready, and nowhere else: a source we can only
 * cite gets no control, so the panel never offers something the server will
 * refuse. The draft comes back to the composer (`onDraft`), which puts it in
 * the editor for the scholar to read and change. Nothing is saved by drafting.
 */

/* The portal lives in the admin UI's own deployment, on its own origin. */
const DOCS_PORTAL_URL =
  process.env.NEXT_PUBLIC_DOCS_PORTAL_URL || "http://localhost:3000/scholar-documents";

const USE_LABEL = {
  draftable: { pill: "sc-status is-published", text: "Ready to draft from" },
  citable: { pill: "sc-status is-scheduled", text: "Can be cited" },
  unusable: { pill: "sc-status", text: "Title only" },
};

/* A contributed document mid-pipeline is not "title only" — it is on its
   way. The API says which with an explicit `pending` flag; the reason
   underneath says exactly where. */

function fmtWords(n) {
  return `${Number(n || 0).toLocaleString()} words`;
}

function sourceKey(source) {
  return `${source.origin}:${source.id}`;
}

function SourceRow({ source, canDraft, busy, anyBusy, onDraft }) {
  const label = source.pending
    ? { pill: "sc-status is-scheduled", text: "In progress" }
    : USE_LABEL[source.use] || USE_LABEL.unusable;

  return (
    <li className="sc-src-row">
      <div className="sc-src-main">
        <p className="sc-src-title">
          {source.title}
          {source.year ? <span className="sc-src-year"> · {source.year}</span> : null}
        </p>
        <p className="sc-src-meta">
          {source.words > 0 ? fmtWords(source.words) : "no readable text yet"}
          <span className="sc-dot">·</span>
          {source.reason}
        </p>
      </div>
      <div className="sc-src-actions">
        <span className={label.pill}>{label.text}</span>
        {canDraft ? (
          <button
            type="button"
            className="sc-write-secondary sc-src-draft"
            onClick={() => onDraft(source)}
            disabled={anyBusy}
            aria-busy={busy || undefined}
          >
            <FaWandMagicSparkles size={11} aria-hidden="true" />
            {busy ? "Drafting…" : "Draft"}
          </button>
        ) : null}
      </div>
    </li>
  );
}

/**
 * @param {object} props
 * @param {(source: object, audience: string) => Promise<void>} [props.onDraft]
 *   Called with a ready source. Absent means the panel is read-only.
 * @param {string|null} [props.draftingKey]
 *   `${origin}:${id}` of the source being drafted from, while one is.
 */
export default function DraftSourcesPanel({ onDraft = null, draftingKey = null, progress = "" }) {
  const [inventory, setInventory] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [audience, setAudience] = useState(DRAFT_AUDIENCES[0].value);

  const load = useCallback(async () => {
    const res = await getDraftSources();
    if (!res.ok) {
      setLoadError(res.error);
      return;
    }
    setLoadError("");
    setInventory(res.data);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const all = inventory ? [...inventory.draftable, ...inventory.citable, ...inventory.unusable] : [];
  const contributed = all.filter((s) => s.origin === "contributed");
  const harvested = all.filter((s) => s.origin !== "contributed");
  const draftableCount = inventory?.counts?.draftable ?? 0;
  const canDraftAny = Boolean(onDraft && inventory?.eligible && draftableCount > 0);
  const anyBusy = Boolean(draftingKey);

  const renderRow = (s, prefix) => (
    <SourceRow
      key={`${prefix}-${s.id}`}
      source={s}
      canDraft={canDraftAny && s.use === "draftable" && !s.pending}
      busy={draftingKey === sourceKey(s)}
      anyBusy={anyBusy}
      onDraft={(source) => onDraft(source, audience)}
    />
  );

  return (
    <details className="sc-write-settings sc-write-sources">
      <summary>
        <FaBookOpen size={13} aria-hidden="true" /> Draft from my research
        {inventory ? <span className="sc-count sc-src-count">{draftableCount} ready</span> : null}
      </summary>

      <div className="sc-write-settings-body">
        {loadError ? (
          <p className="sc-write-msg is-error">{loadError}</p>
        ) : !inventory ? (
          <p className="sc-src-muted">Checking what we hold of your work…</p>
        ) : (
          <>
            {!inventory.eligible ? (
              <p className="sc-src-gate">
                <b>A Legacy Archive feature.</b> {inventory.gateReason} You can still see what
                we hold and add your papers.
              </p>
            ) : null}

            {inventory.nudge ? <p className="sc-src-nudge">{inventory.nudge}</p> : null}

            {canDraftAny ? (
              <div className="sc-src-audience">
                <label htmlFor="sc-src-audience-select">Write the draft for</label>
                <select
                  id="sc-src-audience-select"
                  className="sc-write-input"
                  value={audience}
                  onChange={(event) => setAudience(event.target.value)}
                  disabled={anyBusy}
                >
                  {DRAFT_AUDIENCES.map((a) => (
                    <option key={a.value} value={a.value}>{a.label}</option>
                  ))}
                </select>
                <p className="sc-src-muted">
                  A first draft, written about your paper in the third person, from its text alone.
                  It goes into the editor for you to read and rewrite; nothing is published by drafting.
                </p>
                {anyBusy ? (
                  <p className="sc-src-progress" role="status" aria-live="polite">
                    {progress || "Working…"} <span className="sc-src-muted">This takes about a minute.</span>
                  </p>
                ) : null}
              </div>
            ) : null}

            {harvested.length > 0 ? (
              <>
                <p className="sc-kicker">From public sources</p>
                <ul className="sc-src-list">
                  {harvested.map((s) => renderRow(s, "h"))}
                </ul>
              </>
            ) : null}

            {contributed.length > 0 ? (
              <>
                <p className="sc-kicker">Added by you</p>
                <ul className="sc-src-list">
                  {contributed.map((s) => renderRow(s, "c"))}
                </ul>
              </>
            ) : null}

            {/* The way to change the answer. Opens the Scholar Documents portal,
                which owns consent, scanning, extraction and review — the panel
                only ever reads the result. New tab: the scholar is mid-draft. */}
            <div className="sc-src-add">
              <a
                className="sc-write-secondary sc-src-add-link"
                href={DOCS_PORTAL_URL}
                target="_blank"
                rel="noreferrer"
              >
                Add a paper <FaArrowUpRightFromSquare size={10} aria-hidden="true" />
                <span className="sr-only"> (opens the Scholar Documents portal in a new tab)</span>
              </a>
              <p className="sc-src-muted">
                Papers you upload are checked, have their text extracted, and are reviewed
                before they appear here as ready. That usually takes a little while.
              </p>
            </div>
          </>
        )}
      </div>
    </details>
  );
}
