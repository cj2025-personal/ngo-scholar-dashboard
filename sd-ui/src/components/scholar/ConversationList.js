import Link from "next/link";
import { HiOutlineArrowRight, HiOutlineMicrophone } from "react-icons/hi2";

import { runtime } from "@/lib/podcasts";

/**
 * The conversations a scholar is in, as cards they can act on.
 *
 * ── What these cards lead with, and why ────────────────────────────────────
 * Not the title. An episode's title is the pipeline's framing of a topic; the
 * fact a scholar needs first is that a conversation exists under their name,
 * who it is with, and whether anyone can hear it yet. So the card leads with
 * the pairing and the state, and the title sits inside it.
 *
 * The line that matters most is the one nothing else in either product says:
 * how many of the turns are spoken as them, and how many of those have none
 * of their own words behind them. A scholar can disagree with a summary; they
 * cannot disagree with a sentence they never knew was attributed to them.
 */

const STATE_LABEL = {
  pending: "Not yet released",
  live: "Published",
  making: "Being made",
  stopped: "Stopped",
};

const STATE_CLASS = {
  pending: "is-scheduled",
  live: "is-published",
  making: "is-draft",
  stopped: "is-failed",
};

function Grounding({ voice }) {
  if (!voice || !voice.myTurns) return null;
  const bare = voice.myTurnsWithoutEvidence;
  return (
    <p className={`pod-card__grounding${bare > 0 ? " is-warn" : ""}`}>
      <b>{voice.myTurns}</b> of {voice.turns} turns are spoken as you
      {voice.myQuotes > 0 ? `, drawn from ${voice.myQuotes} of your passages` : ", with none of your passages behind them"}
      {bare > 0 ? ` · ${bare} of your turns cite nothing` : ""}
    </p>
  );
}

export default function ConversationList({ episodes = [], emptyNote }) {
  if (!episodes.length) {
    return (
      <div className="sc-empty">
        <div className="ic" aria-hidden><HiOutlineMicrophone size={24} /></div>
        <h3>No conversations yet</h3>
        <p>{emptyNote || "When a conversation is generated with your work in it, it appears here before anyone can hear it."}</p>
      </div>
    );
  }

  return (
    <div className="pod-grid">
      {episodes.map((ep) => (
        <article key={ep.id} className={`pod-card is-${ep.state}`}>
          <div className="pod-card__head">
            <span className="sc-kicker">
              {ep.with?.name ? `In conversation with ${ep.with.name}` : "Conversation"}
              {ep.with?.kind === "legend" ? " · from the archive" : ""}
            </span>
            <span className={`sc-status ${STATE_CLASS[ep.state] || ""}`}>{STATE_LABEL[ep.state] || ep.status}</span>
          </div>

          <h3 className="pod-card__title">
            <Link href={`/podcasts/${ep.id}`}>{ep.title}</Link>
          </h3>
          {ep.summary ? <p className="pod-card__summary">{ep.summary}</p> : null}

          <Grounding voice={ep.voice} />

          {/* Audio, when there is any. A machine reading nobody signed off is
              labelled as one: "hear how it currently sounds" is a different
              offer from "listen to the episode". */}
          {ep.audio ? (
            <div className="pod-card__audio">
              {ep.audio.isDraft ? <span className="pod-card__draft">Machine reading, not yet approved</span> : null}
              <audio controls preload="none" src={ep.audio.url}>
                <a href={ep.audio.url}>Download the audio</a>
              </audio>
              {ep.audio.durationSeconds ? <span className="pod-card__len">{runtime(ep.audio.durationSeconds)}</span> : null}
            </div>
          ) : null}

          <div className="pod-card__foot">
            <Link href={`/podcasts/${ep.id}`} className="st-link">
              Read what it says <HiOutlineArrowRight size={12} aria-hidden />
            </Link>
            {ep.levels?.waiting ? (
              <span className="pod-card__levels">
                {ep.levels.waiting} version{ep.levels.waiting === 1 ? "" : "s"} for younger readers waiting
              </span>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}
