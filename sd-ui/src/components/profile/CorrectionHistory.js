import { FaScaleBalanced } from "react-icons/fa6";

/**
 * What happened to the corrections this scholar asked for.
 *
 * ── The half that was missing ──────────────────────────────────────────────
 * A scholar could already report that something about them was wrong. Nothing
 * ever told them the outcome — requests were stored and never answered. This
 * is the reply, and it is deliberately on the profile page: the place where
 * they raised the problem is the place they will look for the answer.
 *
 * ── The wait is shown, not hidden ──────────────────────────────────────────
 * An open request carries how long it has been waiting. That is uncomfortable
 * to display and it is the point — a right of reply with no visible clock is a
 * suggestion box, and the number is as much a commitment to us as information
 * for them.
 */

/* One status vocabulary, mapped onto the app's existing pill shapes so these
   read as the same family as everything else rather than a new component. */
const PILL = {
  open: "sc-status is-scheduled",
  accepted: "sc-status is-published",
  applied: "sc-status is-published",
  rejected: "sc-status is-draft",
  withdrawn: "sc-status",
};

function CorrectionRow({ item }) {
  const isOpen = item.status === "open";

  return (
    <li className="sc-corr-row">
      <div className="sc-corr-row__head">
        <span className={PILL[item.status] || "sc-status"}>{item.statusLabel}</span>
        {isOpen && item.daysWaiting !== null ? (
          <span className="sc-corr-wait">
            {item.daysWaiting === 0
              ? "Sent today"
              : `Waiting ${item.daysWaiting} day${item.daysWaiting === 1 ? "" : "s"}`}
          </span>
        ) : null}
        {item.section_key ? (
          <span className="sc-tag-static">{item.section_key.replace(/_/g, " ")}</span>
        ) : null}
      </div>

      {item.field_label ? <p className="sc-corr-field">{item.field_label}</p> : null}
      <p className="sc-corr-message">{item.message}</p>

      {/* Quoted back so a scholar can see exactly what they were objecting to,
          even if the record has since changed underneath them. */}
      {item.current_text ? (
        <blockquote className="sc-corr-quote">{item.current_text}</blockquote>
      ) : null}

      {/* A decline always carries a reason — the API refuses one without it.
          Someone who reported an error about themselves is owed an answer, and
          silence reads as not being believed. */}
      {item.decisionNote ? (
        <p className="sc-corr-note">
          <strong>Our reply:</strong> {item.decisionNote}
        </p>
      ) : null}
    </li>
  );
}

export default function CorrectionHistory({ data }) {
  if (!data) {
    return (
      <article className="sc-prof-card">
        <header className="sc-prof-card-head">
          <div className="sc-prof-card-heading">
            <span className="sc-prof-kicker">
              <FaScaleBalanced size={13} aria-hidden="true" /> Corrections
            </span>
            <h2>We can&rsquo;t load these right now</h2>
          </div>
        </header>
        <p className="sc-prof-lead">
          Please try again shortly. This isn&rsquo;t a statement about your
          requests &mdash; we simply couldn&rsquo;t reach them.
        </p>
      </article>
    );
  }

  const items = data.suggestions ?? [];
  const open = items.filter((item) => item.status === "open").length;

  return (
    <article className="sc-prof-card">
      <header className="sc-prof-card-head">
        <div className="sc-prof-card-heading">
          <span className="sc-prof-kicker">
            <FaScaleBalanced size={13} aria-hidden="true" /> Corrections
          </span>
          <h2>What you&rsquo;ve asked us to change</h2>
        </div>
        {open > 0 ? <span className="sc-count">{open} awaiting reply</span> : null}
      </header>

      {items.length === 0 ? (
        <p className="sc-prof-lead">
          You haven&rsquo;t asked us to change anything yet. Everything on this
          page is curated from public sources &mdash; if any of it is wrong, use
          the pencil beside a section and we&rsquo;ll look into it.
        </p>
      ) : (
        <ul className="sc-corr-list">
          {items.map((item) => (
            <CorrectionRow key={item._id} item={item} />
          ))}
        </ul>
      )}
    </article>
  );
}
