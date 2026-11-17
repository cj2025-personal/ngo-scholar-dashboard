import { HiOutlineDocumentText, HiOutlineFlag } from "react-icons/hi2";

import EpisodeArt from "@/components/podcasts/EpisodeArt";
import EpisodePlayer from "@/components/podcasts/EpisodePlayer";
import OpenTranscript from "@/components/podcasts/OpenTranscript";
import { runtime } from "@/lib/podcasts";

/**
 * One released conversation in the scholar's name, as a row: who it is with,
 * what it is called, how much of it is spoken as them, the player, and the
 * two things they can do about it, read it and say what is wrong.
 *
 * ── Released only (2026-11-16) ─────────────────────────────────────────────
 * Episodes are the company's work, and a scholar sees one once it is out
 * (sd-api podcasts.service RELEASED). So a row has no state to show: every
 * one here can be heard.
 *
 * ── Why a row ──────────────────────────────────────────────────────────────
 * It was a tall media card, one to a 607 px screen. Most scholars have one to
 * three episodes and need them side by side.
 *
 * "Read the transcript" is the one way into the transcript, which opens in a
 * side panel over this list (TranscriptDrawer). The title and cover used to
 * be links to the same place; one control per action.
 *
 * ── What it leads with ──────────────────────────────────────────────────────
 * The line nothing else in the product says is the voice meter: how many
 * turns are spoken as them, and how many of those have none of their own
 * words behind them. A scholar can disagree with a summary; they cannot
 * disagree with a sentence they never knew was attributed to them. One dot per
 * turn of theirs, a hollow red one for each that cites nothing; the sentence
 * beside it says the same, so the dots are never the only signal.
 *
 * ── "Something's wrong?" ───────────────────────────────────────────────────
 * What happens to an episode is the editors' call. What the page owes the
 * scholar is one plain way to reach them about this episode, so the button
 * opens an email to the editors already naming it, with the two things they
 * will need (which turn, what is wrong). An email leaves the scholar a copy of
 * what they asked. Without an address configured (EDITORS_EMAIL) there is
 * nowhere to send it, and the button is not shown.
 */

/** How much of the conversation is in their voice, and how much of that cites nothing of theirs. */
export function VoiceMeter({ voice, action = null }) {
  if (!voice || !voice.turns) return null;
  const mine = voice.myTurns || 0;
  const bare = voice.myTurnsWithoutEvidence || 0;
  const dots = Math.min(mine, 24);
  return (
    <div className={`pod-voice${bare ? " is-warn" : ""}`}>
      {dots ? (
        <span className="pod-voice__dots" aria-hidden>
          {Array.from({ length: dots }, (_, i) => <i key={i} className={i >= dots - Math.min(bare, dots) ? "is-bare" : "is-mine"} />)}
        </span>
      ) : null}
      <span className="pod-voice__text">
        You speak <b>{mine}</b> of {voice.turns} turns
        {mine ? (voice.myQuotes ? `, drawn from ${voice.myQuotes} of your passages` : ", with none of your passages behind them") : ""}
        {bare ? <> · <strong>{bare === 1 ? "1 turn cites nothing of yours" : `${bare} turns cite nothing of yours`}</strong></> : null}
        {/* In the transcript, the way to those turns ("Go to it"), right where they are counted. */}
        {bare && action ? <> · {action}</> : null}
      </span>
    </div>
  );
}

/** A mail to the editors that already names the episode; null when no address is configured. */
export function reportHref(editorsEmail, ep) {
  if (!editorsEmail) return null;
  const subject = `Something is wrong in "${ep.title}"`;
  const body = [`Episode: ${ep.title} (${ep.id})`, "", "Which turn (its number or first words):", "", "What is wrong:", ""].join("\n");
  return `mailto:${editorsEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function ReportButton({ editorsEmail, ep, className = "dash-btn is-ghost" }) {
  const href = reportHref(editorsEmail, ep);
  if (!href) return null;
  return (
    <a href={href} className={`${className} pod-report`} aria-label={`Something's wrong? Tell the editors about ${ep.title}`}>
      <HiOutlineFlag size={15} aria-hidden /> Something&rsquo;s wrong?
    </a>
  );
}

const day = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default function EpisodeCard({ ep, editorsEmail = null }) {
  const withLine = ep.with?.name
    ? `With ${ep.with.name}${ep.with.kind === "legend" ? " · from the archive" : ep.with.field ? ` · ${ep.with.field}` : ""}`
    : "A conversation";
  const meta = [withLine, ep.publishedAt ? `Released ${day(ep.publishedAt)}` : null, runtime(ep.audio?.durationSeconds)].filter(Boolean).join(" · ");

  return (
    <article className="pod-ep">
      <span className="pod-ep__art" aria-hidden>
        <EpisodeArt id={ep.id} withName={ep.with?.name} meName={ep.me?.name} size={64} />
      </span>

      <div className="pod-ep__body">
        <span className="pod-ep__with">{meta}</span>
        <h3 className="pod-ep__title">{ep.title}</h3>
        {ep.summary ? <p className="pod-ep__summary">{ep.summary}</p> : null}
        <VoiceMeter voice={ep.voice} />
        {ep.audio ? (
          <EpisodePlayer src={ep.audio.url} title={ep.title} durationSeconds={ep.audio.durationSeconds} isDraft={ep.audio.isDraft} synthetic={ep.audio.synthetic} />
        ) : (
          <p className="pod-ep__status">No audio here. The transcript is the episode as written.</p>
        )}
      </div>

      <div className="pod-ep__acts">
        <OpenTranscript id={ep.id} className="dash-btn pod-open" ariaLabel={`Read the transcript of ${ep.title}`}>
          <HiOutlineDocumentText size={15} aria-hidden /> Read the transcript
        </OpenTranscript>
        <ReportButton editorsEmail={editorsEmail} ep={ep} />
      </div>
    </article>
  );
}
