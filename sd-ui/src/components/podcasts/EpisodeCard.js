import Link from "next/link";
import { HiOutlineDocumentText } from "react-icons/hi2";

import EpisodeArt from "@/components/podcasts/EpisodeArt";
import EpisodePlayer from "@/components/podcasts/EpisodePlayer";

/**
 * One conversation in the scholar's name, as a media card: its cover, who it
 * is with and where it stands, what it is about, how much of it is spoken as
 * them, and the two ways in, listening and reading.
 *
 * ── What it leads with ──────────────────────────────────────────────────────
 * The pairing and the state, then the title: what a scholar needs first is
 * that a conversation exists under their name, who it is with, and whether
 * anyone can hear it yet. The line nothing else in the product says is the
 * voice meter: how many turns are spoken as them, and how many of those have
 * none of their own words behind them. A scholar can disagree with a summary;
 * they cannot disagree with a sentence they never knew was attributed to them.
 *
 * Reading comes first for an episode not yet released, because that is the
 * moment a correction is easy; listening comes first once it is out.
 */

export const EPISODE_STATE = {
  pending: { label: "Not yet released", pill: "dash-pill is-warn" },
  live: { label: "Released", pill: "dash-pill is-ok" },
  making: { label: "Being made", pill: "dash-pill is-info" },
  stopped: { label: "Stopped", pill: "dash-pill" },
};

/** How much of the conversation is in their voice, and how much of that cites nothing of theirs. */
export function VoiceMeter({ voice }) {
  if (!voice || !voice.turns) return null;
  const mine = voice.myTurns || 0;
  const bare = voice.myTurnsWithoutEvidence || 0;
  const theirs = Math.max(0, voice.turns - mine);
  const parts = [["is-mine", mine - bare], ["is-bare", bare], ["is-theirs", theirs]].filter(([, n]) => n > 0);
  return (
    <div className={`pod-voice${bare ? " is-warn" : ""}`}>
      <span className="pod-voice__bar" aria-hidden>
        {parts.map(([tone, n]) => <i key={tone} className={tone} style={{ flexGrow: n }} />)}
      </span>
      <span className="pod-voice__text">
        <b>{mine}</b> of {voice.turns} turns are spoken as you
        {voice.myQuotes ? `, drawn from ${voice.myQuotes} of your passages` : ", with none of your passages behind them"}
        {bare ? <> · <strong>{bare} of your turns cite nothing</strong></> : null}
      </span>
    </div>
  );
}

export default function EpisodeCard({ ep }) {
  const state = EPISODE_STATE[ep.state] || EPISODE_STATE.making;
  const readFirst = ep.state === "pending" || !ep.audio;
  const withLine = ep.with?.name
    ? `With ${ep.with.name}${ep.with.kind === "legend" ? " · from the archive" : ep.with.field ? ` · ${ep.with.field}` : ""}`
    : "Conversation";

  return (
    <article className={`st-card dash-card pod-ep is-${ep.state}`}>
      <Link href={`/podcasts/${ep.id}`} className="pod-ep__art" tabIndex={-1} aria-hidden>
        <EpisodeArt id={ep.id} withName={ep.with?.name} meName={ep.me?.name} />
      </Link>
      <div className="pod-ep__body">
        <div className="pod-ep__top">
          <span className="pod-ep__with">{withLine}</span>
          <span className={state.pill}>{state.label}</span>
        </div>
        <h3 className="pod-ep__title"><Link href={`/podcasts/${ep.id}`}>{ep.title}</Link></h3>
        {ep.summary ? <p className="pod-ep__summary">{ep.summary}</p> : null}
        {ep.topics?.length ? (
          <ul className="pod-ep__topics" aria-label="Topics">
            {ep.topics.slice(0, 4).map((t) => <li key={t}>{t}</li>)}
          </ul>
        ) : null}
        <VoiceMeter voice={ep.voice} />
        {/* Still being written: nothing to read or hear yet, and the card says so rather than offering it. */}
        <div className={`pod-ep__foot${readFirst ? " is-read-first" : ""}`}>
          {ep.audio ? (
            <EpisodePlayer src={ep.audio.url} title={ep.title} durationSeconds={ep.audio.durationSeconds} isDraft={ep.audio.isDraft} />
          ) : (
            <span className="pod-ep__noaudio">
              {ep.state === "making" ? "Still being written and voiced. It will be ready to read here." : "No audio yet. The transcript is ready to read."}
            </span>
          )}
          {ep.state === "making" ? null : (
            <Link href={`/podcasts/${ep.id}`} className={readFirst ? "dash-btn is-primary" : "dash-btn"}>
              <HiOutlineDocumentText size={15} aria-hidden /> Read the transcript
            </Link>
          )}
        </div>
        {ep.levels?.waiting ? (
          <p className="pod-ep__levels">
            {ep.levels.waiting} version{ep.levels.waiting === 1 ? "" : "s"} for younger readers waiting for approval
          </p>
        ) : null}
      </div>
    </article>
  );
}
