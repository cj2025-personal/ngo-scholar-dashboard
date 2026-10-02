
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

/* One status vocabulary, on the same pills as everything else: amber is
   waiting on someone, green is done, grey is closed. */
const PILL = {
  open: "dash-pill is-warn",
  accepted: "dash-pill is-ok",
  applied: "dash-pill is-ok",
  rejected: "dash-pill",
  withdrawn: "dash-pill",
};

function CorrectionRow({ item }) {
  const isOpen = item.status === "open";

  return (
    <li className="sc-corr-row">
      <div className="sc-corr-row__head">
        <span className={PILL[item.status] || "dash-pill"}>{item.statusLabel}</span>
        {isOpen && item.daysWaiting !== null ? (
          <span className="sc-corr-wait">
            {item.daysWaiting === 0
              ? "Sent today"
              : `Waiting ${item.daysWaiting} day${item.daysWaiting === 1 ? "" : "s"}`}
          </span>
        ) : null}
        {item.section_key ? (
          <span className="sc-corr-section">{item.section_key.replace(/_/g, " ")}</span>
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
      <section className="st-card dash-card" id="corrections" aria-labelledby="corrections-title">
        <div className="dash-card__head">
          <h2 id="corrections-title" className="dash-h2">Corrections</h2>
        </div>
        <p className="dash-muted">
          We can&rsquo;t load these right now. Please try again shortly &mdash; this isn&rsquo;t
          a statement about your requests; we simply couldn&rsquo;t reach them.
        </p>
      </section>
    );
  }

  const items = data.suggestions ?? [];
  const open = items.filter((item) => item.status === "open").length;

  return (
    <section className="st-card dash-card" id="corrections" aria-labelledby="corrections-title">
      <div className="dash-card__head">
        <div className="dash-card__title">
          <h2 id="corrections-title" className="dash-h2">Corrections</h2>
          {open > 0 ? <span className="dash-count">{open} awaiting reply</span> : null}
        </div>
        <span className="dash-muted">What you&rsquo;ve asked us to change, and our answers</span>
      </div>

      {items.length === 0 ? (
        <p className="dash-muted">
          You haven&rsquo;t asked us to change anything yet. Everything on this page is
          curated from public sources; if any of it is wrong, use &ldquo;Suggest an edit&rdquo;
          on that section and the answer will appear here.
        </p>
      ) : (
        <ul className="sc-corr-list">
          {items.map((item) => (
            <CorrectionRow key={item._id} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}
