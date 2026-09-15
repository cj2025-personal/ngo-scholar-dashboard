"use client";

/**
 * The passages behind the block the scholar is on.
 *
 * Answers the first of the two questions that matter for a drafted
 * paragraph: where did this come from. The block's cited passages are shown
 * in full, in the paper's own words, with the sentences the paragraph
 * shares with them marked.
 */

/* Why an implication went too far, in the reviewer's words. */
const REACH_REASONS = {
  outside_fact: "Brings in a fact the paper does not state.",
  stated_as_finding: "States an implication as if the paper found it.",
  does_not_follow: "Does not follow from the passages this paragraph builds on.",
  unsuitable: "Not suitable for this reader.",
};

function sharedSentences(passageText, blockText) {
  const words = new Set(String(blockText || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
  return String(passageText || "").split(/(?<=[.!?])\s+/).map((sentence) => {
    const ws = sentence.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
    const hit = ws.length >= 4 && ws.filter((w) => words.has(w)).length / ws.length >= 0.6;
    return { sentence, hit };
  });
}

export default function SourceRail({ block, passages, provenance }) {
  if (!passages) return <p className="st-muted">Loading the paper&rsquo;s passages…</p>;
  if (passages.length === 0) return <p className="st-muted">This story has no source paper on record, so there is nothing to show behind its paragraphs.</p>;
  if (!block || block.type === "image") return <p className="st-muted">Select a paragraph to see the passages it came from.</p>;
  const refs = (block.sourceRefs || []).map((r) => r.passageId);
  if (refs.length === 0) {
    return <p className="st-muted">{block.ownView ? "This paragraph is your own view; it cites no passage by design." : "This paragraph cites no passage. If it makes a claim about the paper, ask the agent to rewrite it from the source."}</p>;
  }
  const cited = passages.filter((p) => refs.includes(p.id));
  const blockText = String(block.html || "").replace(/<[^>]+>/g, " ");
  const reach = block.extension ? block.reach : null;
  return (
    <div className="sr-wrap">
      <div className="sr-head"><span className="sc-kicker">{block.extension ? "Passages this paragraph builds on" : "Passages behind this paragraph"}</span><span className="st-todo-detail">{refs.join(", ")} of {passages.length}</span></div>
      {provenance?.title ? <div className="st-todo-detail">{provenance.title}{provenance.year ? ` (${provenance.year})` : ""}</div> : null}
      {block.extension ? <p className="st-muted">This paragraph goes beyond the paper: it says what follows from these passages for the reader. It may draw implications; it may not add a fact the paper does not state.</p> : null}
      {cited.map((p) => (
        <div key={p.id} className="sr-passage">
          <b className="sr-id">{p.id}</b>
          <p>
            {sharedSentences(p.text, blockText).map((s, i) => (s.hit ? <mark key={i}>{s.sentence} </mark> : <span key={i}>{s.sentence} </span>))}
          </p>
        </div>
      ))}
      {reach?.claims?.length ? (
        <>
          <div className="sr-head" style={{ marginTop: 6 }}><span className="sc-kicker">Claim by claim</span><span className="st-todo-detail">{reach.claims.filter((c) => c.verdict === "follows").length} of {reach.claims.length} follow from the paper</span></div>
          <ol className="sr-claims">
            {reach.claims.map((c, i) => (
              <li key={i} className={c.verdict === "follows" ? "sr-claim" : "sr-claim is-bad"}>
                <span className={`st-dot ${c.verdict === "follows" ? "is-ok" : "is-bad"}`} aria-hidden />
                <div>
                  <div className="sr-claim-text">“{c.text}”</div>
                  {c.verdict === "follows" ? (
                    <div className="sr-claim-ev">Follows from {c.anchorIds?.join(", ")}.</div>
                  ) : (
                    <div className="sr-claim-ev is-bad">{REACH_REASONS[c.reason] || "Does not follow from the passages this paragraph builds on."} Say what follows from the paper, remove it, or mark the paragraph as your own view.</div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </>
      ) : reach ? <p className="st-muted">Checked as a whole: {reach.verdict === "follows" ? "follows from the paper" : reach.verdict === "partial" ? "partly follows from the paper" : "goes beyond what the paper supports"}.</p> : null}
      {block.fidelity?.claims?.length ? (
        <>
          <div className="sr-head" style={{ marginTop: 6 }}><span className="sc-kicker">Claim by claim</span><span className="st-todo-detail">{block.fidelity.claims.filter((c) => c.verdict === "supported").length} of {block.fidelity.claims.length} supported</span></div>
          <ol className="sr-claims">
            {block.fidelity.claims.map((c, i) => (
              <li key={i} className={c.verdict === "supported" ? "sr-claim" : "sr-claim is-bad"}>
                <span className={`st-dot ${c.verdict === "supported" ? "is-ok" : "is-bad"}`} aria-hidden />
                <div>
                  <div className="sr-claim-text">“{c.text}”</div>
                  {c.verdict === "supported" ? (
                    <div className="sr-claim-ev">{c.passageIds?.join(", ")}: <i>{c.evidence}</i></div>
                  ) : (
                    <div className="sr-claim-ev is-bad">Not in the passages this paragraph cites. Rewrite it from the paper, remove it, or mark the paragraph as your own view.</div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </>
      ) : block.fidelity ? <p className="st-muted">Checked as a whole: {block.fidelity.verdict}.</p> : null}
      {block.traceable === false ? <p className="st-muted">You have edited this paragraph beyond its source; the passages above are what it was drafted from.</p> : null}
    </div>
  );
}
