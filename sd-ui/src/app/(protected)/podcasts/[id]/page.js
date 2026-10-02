import Link from "next/link";
import { notFound } from "next/navigation";
import { HiOutlineArrowLeft } from "react-icons/hi2";

import EpisodeArt from "@/components/podcasts/EpisodeArt";
import { EPISODE_STATE, VoiceMeter } from "@/components/podcasts/EpisodeCard";
import EpisodePlayer from "@/components/podcasts/EpisodePlayer";
import Topbar from "@/components/scholar/Topbar";
import { getDashboardData } from "@/lib/dashboard";
import { getScholarEpisode } from "@/lib/podcasts";

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

        {/* The same cover, player and voice meter as the list, so the page you
            open is plainly the episode you clicked. */}
        <header className="pod-read__head">
          <EpisodeArt id={episode.id} withName={episode.with?.name} meName={episode.me?.name} size={104} />
          <div className="pod-read__id">
            <div className="pod-ep__top">
              <span className="pod-ep__with">
                {episode.with?.name ? `With ${episode.with.name}` : "Conversation"}
                {episode.with?.field ? ` · ${episode.with.field}` : ""}
              </span>
              <span className={(EPISODE_STATE[episode.state] || EPISODE_STATE.making).pill}>{(EPISODE_STATE[episode.state] || EPISODE_STATE.making).label}</span>
            </div>
            <h1>{episode.title}</h1>
            {episode.summary ? <p className="pod-read__summary">{episode.summary}</p> : null}
          </div>
        </header>

        <div className="pod-read__meta">
          <VoiceMeter voice={episode.voice} />
          {episode.audio ? (
            <EpisodePlayer src={episode.audio.url} title={episode.title} durationSeconds={episode.audio.durationSeconds} isDraft={episode.audio.isDraft} size="lg" />
          ) : (
            <span className="pod-ep__noaudio">No audio yet. The transcript below is the episode as written.</span>
          )}

          {bare > 0 ? (
            <p className="pod-read__flag">
              {bare} {bare === 1 ? "turn is" : "turns are"} attributed to you with no passage cited behind
              {bare === 1 ? " it" : " them"}. {bare === 1 ? "It is" : "They are"} marked below.
            </p>
          ) : null}
        </div>

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
