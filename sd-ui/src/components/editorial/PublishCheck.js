"use client";

import { useEffect, useRef, useState } from "react";
import { FaXmark } from "react-icons/fa6";

import { checkStoryRecord, getStoryEvidence, getStoryReadingLevel } from "@/lib/drafting";

import { AUDIENCE_TARGETS, normaliseAudience } from "@/lib/readability";
import { needsAttention, summariseBlocks } from "@/components/editorial/ChecksRail";
import { AGENT_NAME } from "@/lib/kivyn/pose.mjs";

/**
 * Before it goes out under the scholar's name.
 *
 * The things the machine cannot decide: whether every paragraph is supported
 * or the scholar's own, whether the reading level is right for the reader
 * chosen, whether a block that lost its source is meant as commentary, and
 * how the story will be attributed. Publishing is still one click; this is
 * the look before it.
 *
 * A sheet down the right of the page, so the draft stays in view beside it.
 * Grouped by what each check asks of the scholar: what needs them holds
 * publishing; what is worth a look does not; what was not checked says so
 * with a dash, never a tick; what is clear folds away with its count.
 */

const GLYPH = { bad: "!", warn: "i", faint: "–", ok: "✓" };

function Item({ it, onClose }) {
  return (
    <div className={`pc-item is-${it.tone}`}>
      {it.tone === "pending"
        ? <span className="pc-ic is-pending" aria-hidden><span className="ag-spinner" /></span>
        : <span className={`pc-ic is-${it.tone}`} aria-hidden>{GLYPH[it.tone]}</span>}
      <div className="pc-item__body">
        <b>{it.title}</b>
        {it.detail ? <p>{it.detail}</p> : null}
        {it.action ? (
          <button type="button" className="pc-act" disabled={it.action.disabled} onClick={() => { if (it.action.close !== false) onClose(); it.action.onClick(); }}>{it.action.label}</button>
        ) : null}
      </div>
    </div>
  );
}

function Group({ title, tone, items, note = "", onClose }) {
  if (!items.length) return null;
  return (
    <section className={`pc-group is-${tone}`} aria-label={title}>
      <p className="pc-group-title">{title} <span className="pc-group-n">{items.length}</span></p>
      {items.map((it) => <Item key={it.key} it={it} onClose={onClose} />)}
      {note ? <p className="pc-group-note">{note}</p> : null}
    </section>
  );
}

export default function PublishCheck({ blocks, assessment, audience, author, provenance, storyId = null, levels = [], record = null, draftChecks = null, onClose, onPublish, onSchedule, onGoTo, onStoryChanged = null, busy }) {
  const s = summariseBlocks(blocks);
  /* Written from the brief alone: no paper to trace to, count numbers in, or
     watch on the record. What holds it is the author's eyes on every specific. */
  const briefOnly = provenance?.origin === "brief";
  /* Focus moves into the sheet when it opens, so Escape and the keyboard work at once. */
  const modalRef = useRef(null);
  useEffect(() => { modalRef.current?.focus(); }, []);
  /* The rule checks on the text as it is now, not as it was drafted. */
  const [fresh, setFresh] = useState(null);
  useEffect(() => {
    if (!storyId) return undefined;
    let alive = true;
    getStoryEvidence(storyId).then((r) => { if (alive && r.ok) setFresh(r.data); });
    return () => { alive = false; };
  }, [storyId]);
  /* Whether it reads right for its reader is an editor model's ruling on the
     saved story; the grade measured in the page is shown beside it. A ruling
     that cannot be had is said, and does not hold publishing back. */
  const [level, setLevel] = useState({ state: storyId ? "reading" : "none", data: null, error: "" });
  useEffect(() => {
    if (!storyId) return undefined;
    let alive = true;
    getStoryReadingLevel(storyId).then((r) => {
      if (alive) setLevel(r.ok ? { state: "ruled", data: r.data, error: "" } : { state: "failed", data: null, error: r.error });
    });
    return () => { alive = false; };
  }, [storyId]);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");
  async function checkRecord() {
    setChecking(true);
    setCheckError("");
    const r = await checkStoryRecord(storyId);
    setChecking(false);
    if (!r.ok) { setCheckError(r.error); return; }
    const alerts = r.data.story?.record?.alerts?.length || 0;
    onStoryChanged?.(r.data.story, alerts ? "The record has moved against this article's source. See the notice at the top." : "Checked against the record: nothing registered against the paper.");
  }

  const numbers = fresh?.checks?.numbers || draftChecks?.numbers || null;
  const limitations = fresh?.checks?.limitations || draftChecks?.limitations || null;
  const worldClaims = fresh?.checks?.worldClaims || draftChecks?.worldClaims || null;
  const budget = fresh?.checks?.budget || draftChecks?.budget || null;
  const pronouns = fresh?.checks?.pronouns || draftChecks?.pronouns || null;
  const grave = (record?.alerts || []).some((a) => a.kind === "retracted" || a.kind === "withdrawn");
  const levelsLive = (levels || []).filter((l) => l.approved && !l.stale).length;
  const levelsWaiting = (levels || []).filter((l) => !l.approved && !l.stale).length;
  const levelsStale = (levels || []).filter((l) => l.stale).length;
  const target = AUDIENCE_TARGETS[normaliseAudience(audience)];
  const firstAttention = blocks.findIndex(needsAttention);
  const firstLost = blocks.findIndex((b) => b.traceable === false);
  const firstUnverified = blocks.findIndex((b) => b.ownView && b.context?.toVerify?.some((v) => !v.verified));
  const ruled = level.state === "ruled" ? level.data : null;
  const levelOk = ruled ? ruled.verdict !== "fail" : level.state !== "reading";
  const grade = ruled?.fkGrade ?? assessment?.fkGrade ?? null;
  /* "Go to paragraph 4": where it is, said in the reader's terms. */
  const goTo = (i) => (i >= 0 ? { label: `Go to paragraph ${i + 1}`, onClick: () => onGoTo?.(i) } : null);

  const levelItem = level.state === "reading"
    ? { key: "level", short: "reading level", tone: "pending", title: "Reading it as its reader would…", detail: grade !== null ? `Measured grade ${grade} for ${target.label}.` : "Nothing measured yet." }
    : !ruled || ruled.verdict === "warn"
      ? { key: "level", short: "reading level", tone: "warn", title: "Reading level not judged", detail: `${ruled?.reason ? `This article ${ruled.reason}.` : level.error || "The reading level could not be judged just now."} Read it for ${target.label} yourself${grade !== null ? ` (measured grade ${grade})` : ""}.` }
      : {
        key: "level",
        short: "reading level",
        tone: levelOk ? "ok" : "bad",
        title: levelOk ? `Reads right for ${target.label}` : `Reads too ${ruled.judged?.verdict === "too_simple" ? "simple" : "hard"} for ${target.label}`,
        detail: `${ruled.judged?.reason || ""}${grade !== null ? ` Measured grade ${grade}.` : ""}${levelOk ? "" : ` Ask ${AGENT_NAME} to rewrite it for them, or edit.`}`.trim(),
      };
  const troubles = [
    s.partial ? `${s.partial} partly supported` : "",
    s.unsupported ? `${s.unsupported} not supported` : "",
    s.reachPartial ? `${s.reachPartial} partly following from the paper` : "",
    s.overreach ? `${s.overreach} going beyond what it supports` : "",
  ].filter(Boolean).join(", ");
  const items = [
    {
      key: "support",
      short: "supported",
      tone: s.attention === 0 ? "ok" : "bad",
      title: s.attention === 0 ? (s.extension ? "Every drafted paragraph is supported, follows from the paper, or is yours" : "Every drafted paragraph is supported, or is yours") : `${s.attention} paragraph${s.attention === 1 ? "" : "s"} still ${s.attention === 1 ? "needs" : "need"} a look`,
      detail: s.attention === 0
        ? `${s.supported} supported by their passages${s.extension ? `, ${s.follows} beyond the paper and following from it` : ""}${s.edited ? `, ${s.edited} rewritten by you` : ""}${s.ownView ? `, ${s.ownView} marked as your view` : ""}.`
        /* Each of these is a control in the Sources tab for the paragraph,
           and "Go to paragraph" opens it there. */
        : `${troubles}. Go to it and you can rewrite it and have it checked again, take it on as your own view, or delete it.`,
      action: s.attention ? goTo(firstAttention) : null,
    },
    ...(pronouns && pronouns.ok === false ? [{
      key: "pronouns",
      tone: "warn",
      title: "This article calls you by two different pronouns",
      detail: pronouns.sentence,
      action: pronouns.blocks?.length ? goTo(pronouns.blocks[0] - 1) : null,
    }] : []),
    ...(budget && budget.ok === false && !briefOnly ? [{
      key: "budget",
      tone: "warn",
      title: "More of this article goes beyond the paper than comes from it",
      detail: `${budget.sentence} Readers came for what the paper found; keep that the larger part.`,
    }] : []),
    ...(worldClaims && worldClaims.ok === false ? [{
      key: "world",
      tone: "warn",
      title: `${worldClaims.hits.length} sentence${worldClaims.hits.length === 1 ? "" : "s"} beyond the paper read${worldClaims.hits.length === 1 ? "s" : ""} as a claim about the world`,
      detail: `${worldClaims.hits.map((h) => `"${h.sentence}" (paragraph ${h.block})`).join("; ")}. An implication says what would follow; a claim says what is done. Only the first is yours to make from the paper alone.`,
      action: goTo(worldClaims.hits[0].block - 1),
    }] : []),
    ...(s.toVerify ? [{
      /* The one gate the machine holds shut: a specific it brought in from
         outside the paper stays unpublished until the author has ticked it. */
      key: "verify",
      short: "your specifics",
      tone: s.unverified === 0 ? "ok" : "bad",
      title: s.unverified === 0
        ? `Every specific in your own context is verified by you (${s.toVerify})`
        : `${s.unverified} specific${s.unverified === 1 ? "" : "s"} in your own context ${s.unverified === 1 ? "is" : "are"} not yet verified`,
      detail: s.unverified === 0
        ? briefOnly ? "You ticked each one in Checks. Readers are told this is your own account, not drawn from your research." : "You ticked each one in Checks. Readers see these paragraphs as yours, not the paper's."
        : `${AGENT_NAME} ${briefOnly ? "wrote them from your brief, with no paper behind them" : "brought them in from outside the paper"}. Tick each in Checks once you have checked it, or cut it. Nothing it invented reaches a reader without your eyes on it.`,
      action: s.unverified ? goTo(firstUnverified) : null,
    }] : []),
    levelItem,
    briefOnly ? null : {
      key: "traces",
      short: "traces",
      tone: s.edited === 0 ? "ok" : "warn",
      title: s.edited === 0 ? "Every drafted paragraph still traces to its source" : `${s.edited} paragraph${s.edited === 1 ? " has" : "s have"} lost ${s.edited === 1 ? "its" : "their"} source`,
      detail: s.edited === 0 ? "Readers can open the passage behind every drafted paragraph." : "You rewrote it from scratch, so it will carry no source chip. That is fine if it is your own view.",
      action: s.edited ? goTo(firstLost) : null,
    },
    briefOnly ? null : record?.alerts?.length ? {
      /* A retraction blocks publishing until the scholar has marked it as
         seen on the banner. That act is recorded; publishing over it is then
         their decision, and a deliberate one. */
      key: "record",
      tone: grave && !record.acknowledgedAt ? "bad" : "warn",
      title: grave ? "The paper this article rests on has been withdrawn from the record" : "The paper this article rests on has been corrected",
      detail: `${record.headline} Publishing without a notice would put your name over claims the record has changed.${grave && !record.acknowledgedAt ? " Mark it as seen on the banner above to publish anyway." : ""}`,
    } : record ? {
      key: "record",
      short: "the record",
      tone: "ok",
      title: "Nothing registered against the paper",
      detail: `Checked against the record${record.checkedAt ? ` on ${new Date(record.checkedAt).toLocaleDateString()}` : ""}: no retraction, withdrawal or correction.`,
    } : {
      key: "record",
      tone: "faint",
      title: "Retraction record not checked yet",
      detail: "Whether the paper has been retracted or corrected since it was drafted from.",
      action: storyId ? { label: checking ? "Checking…" : "Check now", onClick: checkRecord, close: false, disabled: checking } : null,
    },
    briefOnly ? null : numbers ? {
      key: "numbers",
      short: "numbers",
      tone: numbers.ok ? "ok" : "bad",
      title: numbers.ok ? `Every number is in the paper (${numbers.numbers} checked${fresh ? ", on the current text" : ""})` : numbers.misses.length === 1 ? "A number is not in the passage it cites" : `${numbers.misses.length} numbers are not in the passages they cite`,
      detail: numbers.ok ? "A rule, not a model, checked every figure against the passages it cites." : `${numbers.misses.map((m) => `“${m.number}” in paragraph ${m.block}`).join(", ")}. A fluent wrong number is the mistake that gets past a reader.`,
      action: numbers.ok ? null : goTo(numbers.misses[0].block - 1),
    } : {
      key: "numbers",
      tone: "faint",
      title: "Numbers not checked",
      detail: "The figures were not checked against the passages they cite.",
    },
    ...(limitations && limitations.ok !== null ? [{
      key: "limits",
      short: "caveats",
      tone: limitations.ok ? "ok" : "warn",
      title: limitations.ok ? "The paper's own caveats are in the article" : "The paper's own caveats are not in the article",
      detail: limitations.sentence,
    }] : []),
    (levels || []).length === 0 ? {
      key: "levels",
      tone: "faint",
      title: "Not yet written for other reading ages",
      detail: "Readers of other ages get the article as written. You can write it for every age from Reading ages in the bar.",
    } : {
      key: "levels",
      short: "reading ages",
      tone: levelsStale || levelsWaiting ? "warn" : "ok",
      title: `${levelsLive} reading level${levelsLive === 1 ? "" : "s"} live for readers${levelsWaiting ? `, ${levelsWaiting} waiting for your approval` : ""}${levelsStale ? `, ${levelsStale} out of date` : ""}`,
      detail: levelsStale ? "An out-of-date level is never shown. Rewrite it from Reading ages in the bar." : levelsWaiting ? "A level is shown to readers once you approve it, from Reading ages in the bar." : "Readers can switch between the levels you approved.",
    },
  ];
  const of = (tone) => items.filter((i) => i && i.tone === tone);
  const needs = of("bad");
  const reading = of("pending");
  const looks = of("warn");
  const unchecked = of("faint");
  const clear = of("ok");
  /* A check still being read holds publishing until it has an answer. */
  const blocking = needs.length > 0;
  const pending = reading.length > 0;
  const holdReason = pending
    ? "Waiting on a check that is still reading the article."
    : needs.length
      ? `Resolve ${needs.length} item${needs.length === 1 ? "" : "s"} to publish`
      : looks.length
        ? "Worth a look first; nothing stops you publishing."
        : "Everything the machine checks is clear.";
  const tally = [
    needs.length ? `${needs.length} need${needs.length === 1 ? "s" : ""} you` : "",
    looks.length ? `${looks.length} worth a look` : "",
    unchecked.length ? `${unchecked.length} not checked` : "",
    pending ? "still reading" : "",
    `${clear.length} clear`,
  ].filter(Boolean);

  return (
    <div
      className="pc-scrim"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pc-title"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
    >
      <div className="pc-modal pc-sheet" ref={modalRef} tabIndex={-1}>
        <header className="pc-head">
          <div className="pc-head-text">
            <span className="sc-kicker">Before it goes out under your name</span>
            <h2 id="pc-title" className="pc-title">Publish check</h2>
          </div>
          {needs.length ? <span className="pc-head-n" aria-label={`${needs.length} need${needs.length === 1 ? "s" : ""} you`}>{needs.length}</span> : null}
          <button type="button" className="pc-close" aria-label="Close the publish check" onClick={onClose}><FaXmark size={14} aria-hidden /></button>
          <p className="pc-summary" role="status">
            {tally.map((t, i) => <span key={t} className={i === 0 && needs.length ? "pc-tally is-bad" : "pc-tally"}>{t}</span>)}
          </p>
        </header>
        <div className="pc-items">
          <Group title="Still reading" tone="pending" items={reading} onClose={onClose} />
          <Group title="Needs you" tone="bad" items={needs} onClose={onClose} />
          <Group title="Worth a look" tone="warn" items={looks} onClose={onClose} />
          <Group title="Not checked" tone="faint" items={unchecked} note="A dash, not a tick: nothing has been checked here." onClose={onClose} />
          {checkError ? <p className="sc-write-msg is-error">{checkError}</p> : null}
          {clear.length ? (
            <details className="pc-clear">
              <summary>
                <span className="pc-ic is-ok" aria-hidden>✓</span>
                <span>Clear · {clear.length} check{clear.length === 1 ? "" : "s"}: {clear.map((i) => i.short).filter(Boolean).join(", ")}</span>
              </summary>
              {clear.map((it) => <Item key={it.key} it={it} onClose={onClose} />)}
            </details>
          ) : null}

          <section className="pc-about" aria-label="What goes out with it">
            <div className="pc-about__row">
              <b>What goes on the record</b>
              <p>{fresh ? fresh.summary : "Every claim, the passage it rests on, and your approval are recorded and signed with the article, for anyone to verify."}</p>
            </div>
            <div className="pc-about__row">
              <b>How it will be attributed</b>
              <div className="pc-preview">
                {author?.name ? (
                  <div className="st-row"><span className="sc-me sc-me--sm" aria-hidden>{author.initials || ""}</span><div><div className="pc-author">{author.name}</div>{author.affiliation ? <div className="st-todo-detail">{author.affiliation}</div> : null}</div></div>
                ) : <p className="st-muted">Your byline could not be resolved from your record; the story would publish without one.</p>}
                {provenance?.line ? <div className="pc-prov">{provenance.line}</div> : null}
                {provenance?.line ? <div className="st-todo-detail">Readers can open the passage behind any drafted paragraph.</div> : null}
              </div>
            </div>
          </section>
        </div>
        <div className="pc-actions">
          <button type="button" className="sc-write-ghost" onClick={onClose}>Back to the draft</button>
          <span className={`pc-hold${needs.length || pending ? " is-held" : ""}`}>{holdReason}</span>
          <div className="pc-actions-go">
            {onSchedule ? <button type="button" className="sc-write-secondary" disabled={busy} onClick={onSchedule}>Schedule…</button> : null}
            <button type="button" className="sc-write-publish pc-publish" disabled={busy || blocking || pending} onClick={onPublish}>{busy ? "Publishing…" : "Publish now"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
