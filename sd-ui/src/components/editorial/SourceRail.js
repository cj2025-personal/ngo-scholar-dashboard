"use client";

/**
 * The passages behind the block the scholar is on.
 *
 * Answers the first of the two questions that matter for a drafted
 * paragraph: where did this come from. The block's cited passages are shown
 * in full, in the paper's own words, with the sentences the paragraph
 * shares with them marked.
 */

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
  return (
    <div className="sr-wrap">
      <div className="sr-head"><span className="sc-kicker">Passages behind this paragraph</span><span className="st-todo-detail">{refs.join(", ")} of {passages.length}</span></div>
      {provenance?.title ? <div className="st-todo-detail">{provenance.title}{provenance.year ? ` (${provenance.year})` : ""}</div> : null}
      {cited.map((p) => (
        <div key={p.id} className="sr-passage">
          <b className="sr-id">{p.id}</b>
          <p>
            {sharedSentences(p.text, blockText).map((s, i) => (s.hit ? <mark key={i}>{s.sentence} </mark> : <span key={i}>{s.sentence} </span>))}
          </p>
        </div>
      ))}
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
