import { VoiceMeter } from "@/components/podcasts/EpisodeCard";
import EpisodePlayer from "@/components/podcasts/EpisodePlayer";
import JumpToTurn from "@/components/podcasts/JumpToTurn";

/**
 * One conversation, read by the person it speaks as: what is inside the
 * transcript panel.
 *
 * ── Why the transcript is the content ──────────────────────────────────────
 * A player and a summary would be lighter and worse. The thing a named
 * scholar has to be able to do is read the sentences attributed to them and
 * see what each was built from, which is exactly what an audio file
 * prevents. So their own turns are marked, and every turn carries the
 * passages the pipeline cited for it.
 *
 * A turn of theirs citing nothing is called out, with a way straight to it
 * ("Go to it", stepping through them when there are several), in its own
 * words on the turn and not by colour alone: a machine has put words in a living
 * person's mouth with no source. Turns are numbered, because "Something's
 * wrong?" asks which turn, and a number is the easiest way to say it.
 *
 * The player stays at the top of the panel while the turns scroll under it:
 * listening and reading go together.
 */
export default function TranscriptBody({ episode }) {
  const turns = episode.turns || [];
  const unsourced = turns.filter((t) => t.mine && !t.evidence.length);
  const turnId = (t) => `pod-turn-${t.index}`;

  return (
    <>
      {/* Pinned while the turns scroll: listening and reading go together, and the
          count of turns citing nothing carries the way to them, so it is never out of reach. */}
      <div className="pod-panel__listen">
        <VoiceMeter voice={episode.voice} action={<JumpToTurn turnIds={unsourced.map(turnId)} />} />
        {episode.audio ? (
          <EpisodePlayer src={episode.audio.url} title={episode.title} durationSeconds={episode.audio.durationSeconds} isDraft={episode.audio.isDraft} synthetic={episode.audio.synthetic} />
        ) : (
          <p className="pod-ep__status">No audio here. The transcript is the episode as written.</p>
        )}
      </div>

      {episode.summary ? <p className="pod-panel__summary">{episode.summary}</p> : null}
      {episode.openingNote ? <p className="pod-read__note">{episode.openingNote}</p> : null}

      <ol className="pod-turns" aria-label="The conversation, turn by turn">
        {turns.map((turn) => {
          const bare = turn.mine && !turn.evidence.length;
          return (
            <li key={turn.index} id={turnId(turn)} tabIndex={-1} className={`pod-turn${turn.mine ? " is-mine" : ""}${bare ? " is-unsourced" : ""}`}>
              <div className="pod-turn__who">
                <span className="pod-turn__n">{turn.index + 1}</span>
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
              ) : bare ? (
                <p className="pod-turn__ev-none">Nothing of yours is cited for this turn.</p>
              ) : null}
            </li>
          );
        })}
      </ol>

      {episode.closingNote ? <p className="pod-read__note">{episode.closingNote}</p> : null}
    </>
  );
}
