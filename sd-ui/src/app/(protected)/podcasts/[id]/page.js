import Link from "next/link";
import { notFound } from "next/navigation";
import { HiOutlineArrowLeft } from "react-icons/hi2";

import Topbar from "@/components/scholar/Topbar";
import { getDashboardData } from "@/lib/dashboard";
import { getScholarEpisode, runtime } from "@/lib/podcasts";

export const dynamic = "force-dynamic";

/**
 * One conversation, read by the person it speaks as.
 *
 * ── Why the transcript is the page ─────────────────────────────────────────
 * A player and a summary would be a lighter page and a worse one. The thing a
 * named scholar has to be able to do is read the sentences attributed to them
 * and see what each was built from — which is exactly what an audio file
 * prevents. So the transcript is the page, their own turns are marked, and
 * every turn carries the passages the pipeline cited for it.
 *
 * A turn of theirs citing nothing is called out rather than left to be
 * noticed. That is the case where a machine has put words in a living
 * person's mouth with no source, and it is the reason this page exists.
 */
export default async function EpisodePage({ params }) {
  const { id } = await params;
  const [dashboard, episode] = await Promise.all([getDashboardData(), getScholarEpisode(id)]);
  if (!episode) notFound();

  const profile = dashboard?.profile || {};
  const me = {
    initials: profile.initials || "SC",
    name: profile.name || "Scholar",
    institution:
      (dashboard?.profileDetails || []).find((d) => d.label === "Institution")?.value || "",
  };

  const bare = episode.voice?.myTurnsWithoutEvidence || 0;

  return (
    <div className="sc-shell">
      <Topbar activeHref="/podcasts" me={me} />
      <div className="sc-page pod-read">
        <Link href="/podcasts" className="st-link pod-read__back">
          <HiOutlineArrowLeft size={12} aria-hidden /> All conversations
        </Link>

        <header className="pod-read__head">
          <span className="sc-kicker">
            {episode.with?.name ? `With ${episode.with.name}` : "Conversation"}
            {episode.with?.field ? ` · ${episode.with.field}` : ""}
          </span>
          <h1>{episode.title}</h1>
          {episode.summary ? <p className="pod-read__summary">{episode.summary}</p> : null}

          <p className="pod-read__counts">
            <b>{episode.voice.myTurns}</b> of {episode.voice.turns} turns are spoken as you
            {episode.voice.myQuotes ? `, drawn from ${episode.voice.myQuotes} of your passages` : ""}.
            {episode.state === "live" ? " This episode is published." : " It has not been released."}
          </p>

          {bare > 0 ? (
            <p className="pod-read__flag">
              {bare} {bare === 1 ? "turn is" : "turns are"} attributed to you with no passage cited behind
              {bare === 1 ? " it" : " them"}. {bare === 1 ? "It is" : "They are"} marked below.
            </p>
          ) : null}

          {episode.audio ? (
            <div className="pod-read__audio">
              {episode.audio.isDraft ? (
                <span className="pod-card__draft">Machine reading, not yet approved</span>
              ) : null}
              <audio controls preload="none" src={episode.audio.url}>
                <a href={episode.audio.url}>Download the audio</a>
              </audio>
              {episode.audio.durationSeconds ? <span className="pod-card__len">{runtime(episode.audio.durationSeconds)}</span> : null}
            </div>
          ) : null}
        </header>

        {episode.openingNote ? <p className="pod-read__note">{episode.openingNote}</p> : null}

        <div className="pod-turns">
          {episode.turns.map((turn) => {
            const unsourced = turn.mine && !turn.evidence.length;
            return (
              <article
                key={turn.index}
                className={`pod-turn${turn.mine ? " is-mine" : ""}${unsourced ? " is-unsourced" : ""}`}
              >
                <div className="pod-turn__who">
                  <span className="pod-turn__name">{turn.speaker}</span>
                  {turn.mine ? <span className="pod-turn__badge">you</span> : null}
                </div>
                <p className="pod-turn__text">{turn.text}</p>

                {turn.evidence.length ? (
                  <details className="pod-turn__ev">
                    <summary>
                      {turn.evidence.length} passage{turn.evidence.length === 1 ? "" : "s"} behind this
                    </summary>
                    <ul>
                      {turn.evidence.map((e) => (
                        <li key={e.id}>
                          <span className="pod-turn__ev-from">{e.mine ? "Your work" : episode.with?.name || "The archive"}{e.from ? ` · ${e.from}` : ""}</span>
                          <q>{e.text}</q>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : unsourced ? (
                  <p className="pod-turn__ev-none">Nothing of yours is cited for this turn.</p>
                ) : null}
              </article>
            );
          })}
        </div>

        {episode.closingNote ? <p className="pod-read__note">{episode.closingNote}</p> : null}

        {/* Read-only is the design, not a gap, so this says what the portal is
            for rather than apologising for a button that is not coming. */}
        <aside className="pod-read__standing">
          <h2 className="st-h2">If this is wrong</h2>
          <p>
            This page shows you what has been made in your name. Changing, approving or
            withdrawing an episode happens in the editorial system that generated it, not here.
            If anything on this page misrepresents your work, contact the editors — and do it
            before the episode is released, while it is still easy to stop.
          </p>
        </aside>
      </div>
    </div>
  );
}
