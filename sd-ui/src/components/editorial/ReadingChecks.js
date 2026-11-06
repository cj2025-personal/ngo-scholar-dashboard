"use client";

import { useCallback, useEffect, useState } from "react";

import { DRAFT_AUDIENCES, getReadingChecks, setReadingCheckQuestion } from "@/lib/drafting";

/*
 * Reading checks, in the Checks rail: the questions learners answer after
 * reading this story, one set per reading age readers can see it at. The
 * learner app writes them once the story is published - each kept only when a
 * judge ruled its answer right - and the scholar can take any question out,
 * or put it back. With too few left, a set stops being asked until more are
 * written.
 *
 * Where readers got lost: beside each question, how many readers answered it
 * and how many got it right, the wrong answer most of them chose, and the
 * place in the story it is answered. Counts only, and only once enough
 * readers stand behind them (the learner app's floor, 5): under it the
 * scholar is told "fewer than 5", never the number.
 */

const bandLabel = (band) => DRAFT_AUDIENCES.find((a) => a.value === band)?.label ?? band;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/* The questions most readers missed, hardest first; none when nobody missed. */
const missedMost = (questions) =>
  questions
    .filter((q) => typeof q.results?.answered === "number" && q.results.right < q.results.answered)
    .map((q) => ({ question: q.question, missed: q.results.answered - q.results.right, answered: q.results.answered }))
    .sort((a, b) => b.missed / b.answered - a.missed / a.answered)
    .slice(0, 3);

function QuestionResults({ q, check }) {
  const r = q.results;
  return (
    <>
      {typeof check.readers === "number" ? (
        typeof r?.answered === "number" ? (
          <p className="rck-result">
            <b>{r.right} of {r.answered}</b> readers got it right
            {r.commonWrong ? <> · most who missed it chose “{r.commonWrong}”</> : null}
          </p>
        ) : (
          <p className="rck-result is-quiet">Fewer than {check.floor} readers have answered this one</p>
        )
      ) : null}
      {q.passage?.quote ? (
        <p className="rck-passage">
          <span>Answered in your story:</span> “{q.passage.quote}”
        </p>
      ) : q.passage?.whole ? (
        <p className="rck-passage">
          <span>About the story as a whole</span>
        </p>
      ) : null}
    </>
  );
}

function CheckCard({ storyId, check, onChanged }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const toggle = async (question, dropped) => {
    setBusy(question);
    setError(null);
    const result = await setReadingCheckQuestion(storyId, check.id, question, dropped);
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onChanged(result.data.check);
  };

  const live = check.questions.filter((q) => !q.dropped).length;
  const lost = typeof check.readers === "number" ? missedMost(check.questions) : [];
  return (
    <article className="rc-card">
      <header className="rc-card__head">
        <b>{bandLabel(check.band)}</b>
        <span className={`rc-status is-${check.status}`}>
          {check.status === "ready" ? `Asked after reading · ${live} question${live === 1 ? "" : "s"}` : "Not asked yet"}
        </span>
      </header>
      {check.waiting ? <p className="rc-note">{check.waiting}</p> : null}
      {typeof check.readers === "number" ? (
        <div className="rck-lost">
          <p className="rck-lost__head">{plural(check.readers, "reader has", "readers have")} answered</p>
          {lost.length ? (
            <ol className="rck-lost__list" aria-label="Missed most often">
              {lost.map((item) => (
                <li key={item.question}>
                  <span className="rck-lost__q">{item.question}</span> <span className="rck-lost__n">{item.missed} of {item.answered} missed it</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="rc-note">Every reader got every question right.</p>
          )}
        </div>
      ) : check.status === "ready" ? (
        <p className="rc-note">Fewer than {check.floor ?? 5} readers have answered yet. How they did shows here once {check.floor ?? 5} have.</p>
      ) : null}
      <ol className="rc-questions">
        {check.questions.map((q) => (
          <li key={q.question} className={q.dropped ? "is-dropped" : undefined}>
            <p className="rc-q">{q.question}</p>
            <ul className="rc-options">
              {q.options.map((option, index) => (
                <li key={option} className={index === q.answerIndex ? "is-key" : undefined}>
                  {index === q.answerIndex ? <span className="sr-only">Answer: </span> : null}
                  {option}
                </li>
              ))}
            </ul>
            {q.rationale ? <p className="rc-why">{q.rationale}</p> : null}
            <QuestionResults q={q} check={check} />
            <button type="button" className="ck-act" disabled={busy !== null} onClick={() => toggle(q.question, !q.dropped)}>
              {busy === q.question ? "Saving…" : q.dropped ? "Put it back" : "Leave it out"}
            </button>
          </li>
        ))}
      </ol>
      {check.judgedOut ? (
        <p className="rc-note">
          {check.judgedOut} more {check.judgedOut === 1 ? "was" : "were"} written and left out, because a judge could not agree the answer was right.
        </p>
      ) : null}
      {error ? <p className="rc-error" role="alert">{error}</p> : null}
    </article>
  );
}

export default function ReadingChecks({ storyId }) {
  const [state, setState] = useState({ status: "loading", checks: [], error: null });

  const load = useCallback(async () => {
    if (!storyId) return;
    const result = await getReadingChecks(storyId);
    setState(result.ok ? { status: "ready", checks: result.data.checks ?? [], error: null } : { status: "error", checks: [], error: result.error });
  }, [storyId]);

  useEffect(() => {
    let live = true;
    if (!storyId) return undefined;
    getReadingChecks(storyId).then((result) => {
      if (!live) return;
      setState(result.ok ? { status: "ready", checks: result.data.checks ?? [], error: null } : { status: "error", checks: [], error: result.error });
    });
    return () => {
      live = false;
    };
  }, [storyId]);

  if (!storyId) return null;
  const replace = (next) => setState((s) => ({ ...s, checks: s.checks.map((c) => (c.id === next.id ? next : c)) }));

  return (
    <details className="ck-fold rc-fold">
      <summary>
        <span>
          Reading checks
          {state.status === "ready" && state.checks.length ? ` · ${state.checks.length} reading age${state.checks.length === 1 ? "" : "s"}` : ""}
        </span>
      </summary>
      {state.status === "loading" ? <p className="st-muted">Reading the checks…</p> : null}
      {state.status === "error" ? (
        <p className="st-muted">
          {state.error} <button type="button" className="ck-act" onClick={load}>Try again</button>
        </p>
      ) : null}
      {state.status === "ready" && state.checks.length === 0 ? (
        <p className="st-muted">
          Once the story is published, learners at each reading age it is approved for answer a few questions after reading it. They are written within a few hours of publishing, and you can leave any of them out here.
        </p>
      ) : null}
      {state.checks.map((check) => (
        <CheckCard key={check.id} storyId={storyId} check={check} onChanged={replace} />
      ))}
    </details>
  );
}
