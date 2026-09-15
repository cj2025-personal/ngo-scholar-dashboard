"use client";

import { useCallback, useEffect, useState } from "react";
import { FaArrowUpRightFromSquare, FaRotate } from "react-icons/fa6";

import { getStoryEvidence, publicEvidenceUrl } from "@/lib/drafting";

/**
 * What this article rests on, as a whole, and whether anyone could check it.
 *
 * The Source rail answers for one paragraph; this answers for the article:
 * how many claims were checked, how many held, whether every number is in
 * the paper, whether the paper's own caveats made it in, and whether the
 * passages we serve are the ones the claims were judged against. When the
 * story is public, the same record is signed and published, and the link
 * here is the one a teacher or a journal would follow to verify it without
 * asking us.
 */
export default function EvidenceRail({ storyId, version, status, slug, onGoTo }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setBusy(true);
    getStoryEvidence(storyId).then((r) => {
      setBusy(false);
      if (!r.ok) { setError(r.error); return; }
      setError("");
      setData(r.data);
    });
  }, [storyId]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load, version]);

  if (error && !data) return <p className="sc-write-msg is-error">{error}</p>;
  if (!data) return <p className="st-muted">Reading the evidence…</p>;

  const m = data.manifest;
  const t = m.totals || {};
  const numbers = data.checks?.numbers;
  const limitations = data.checks?.limitations;
  const worldClaims = data.checks?.worldClaims;
  const budget = data.checks?.budget;
  const isPublic = status === "published" || status === "scheduled";

  return (
    <div className="ev-wrap">
      <div className="sr-head">
        <span className="sc-kicker">Evidence</span>
        <button type="button" className="st-link" onClick={load} disabled={busy}><FaRotate size={10} aria-hidden /> {busy ? "Checking…" : "Refresh"}</button>
      </div>
      <p className="ev-summary">{data.summary}</p>

      <div className="ev-stats">
        <div><b>{t.claims || 0}</b><span>claims checked</span></div>
        <div><b className={t.unsupported ? "is-warn" : ""}>{t.supported || 0}</b><span>supported</span></div>
        <div><b>{t.cited || 0}</b><span>paragraphs from the paper</span></div>
        {t.extension ? <div><b className={t.overreach ? "is-warn" : ""}>{t.follows || 0}</b><span>implications following from it{t.overreach ? `, ${t.overreach} too far` : ""}</span></div> : null}
      </div>

      <div className="ck-list">
        <div className="ck-item">
          <span className={`st-dot ${numbers?.ok ? "is-ok" : numbers ? "is-bad" : "is-faint"}`} />
          <span>
            {numbers ? (numbers.ok ? `Every number is in the paper (${numbers.numbers} checked)` : `${numbers.misses.length} number${numbers.misses.length === 1 ? "" : "s"} not in the passages cited: ${numbers.misses.map((x) => `${x.number} in block ${x.block}`).join(", ")}`) : "Numbers not checked"}
          </span>
          {numbers && !numbers.ok ? <button type="button" className="st-link" onClick={() => onGoTo?.(numbers.misses[0].block - 1)}>Go to it</button> : null}
        </div>
        <div className="ck-item">
          <span className={`st-dot ${limitations?.ok === true ? "is-ok" : limitations?.ok === false ? "is-warn" : "is-faint"}`} />
          <span>{limitations?.sentence || "The paper states no limitations we could find."}</span>
        </div>
        {budget && budget.ok !== null ? (
          <div className="ck-item">
            <span className={`st-dot ${budget.ok ? "is-ok" : "is-warn"}`} />
            <span>{budget.sentence}</span>
          </div>
        ) : null}
        {worldClaims && worldClaims.ok !== null ? (
          <div className="ck-item">
            <span className={`st-dot ${worldClaims.ok ? "is-ok" : "is-warn"}`} />
            <span>{worldClaims.ok ? "Nothing beyond the paper reads as a claim about the world" : `${worldClaims.hits.length} sentence${worldClaims.hits.length === 1 ? "" : "s"} beyond the paper read${worldClaims.hits.length === 1 ? "s" : ""} as a claim about the world: ${worldClaims.hits.map((h) => `block ${h.block}`).join(", ")}`}</span>
            {!worldClaims.ok ? <button type="button" className="st-link" onClick={() => onGoTo?.(worldClaims.hits[0].block - 1)}>Go to it</button> : null}
          </div>
        ) : null}
        <div className="ck-item">
          <span className={`st-dot ${data.passagesCheck?.mismatched?.length ? "is-bad" : "is-ok"}`} />
          <span>{data.passagesCheck?.mismatched?.length ? `${data.passagesCheck.mismatched.length} passage${data.passagesCheck.mismatched.length === 1 ? "" : "s"} no longer match what the claims were checked against` : `The ${data.passagesCheck?.matched || 0} passages behind this article are the ones the claims were checked against`}</span>
        </div>
        <div className="ck-item">
          <span className={`st-dot ${data.signed ? "is-ok" : "is-warn"}`} />
          <span>{data.signed ? `Signed by this deployment · key ${data.keyId}` : "This deployment has no signing key; the record is published unsigned"}</span>
        </div>
      </div>

      <div className="sc-divider" />
      {isPublic && slug ? (
        <>
          <span className="sc-kicker">For anyone to check</span>
          <p className="st-muted">The signed record is public. A teacher, a journal or a reader can fetch it and the public key and verify every claim without asking us.</p>
          <a className="st-link" href={publicEvidenceUrl(slug)} target="_blank" rel="noreferrer">Open the signed record <FaArrowUpRightFromSquare size={10} aria-hidden /></a>
        </>
      ) : (
        <>
          <span className="sc-kicker">When you publish</span>
          <p className="st-muted">This record is a preview. When you publish, it is signed and made public with the article, with your approval on it as version {version}.</p>
        </>
      )}
      {limitations?.heuristic ? <p className="st-muted ev-fine">Limitations are found by wording, so this is a prompt to look, not a verdict.</p> : null}
    </div>
  );
}
