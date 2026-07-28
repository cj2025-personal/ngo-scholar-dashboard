import {
  FaArrowUpRightFromSquare,
  FaMicrophone,
  FaPlay,
} from "react-icons/fa6";

/** Map a free-form episode state onto the shared status-pill modifiers. */
function stateClass(state) {
  const s = String(state || "").toLowerCase();
  if (s.includes("publish")) return "is-published";
  if (s.includes("draft")) return "is-draft";
  if (s.includes("schedul")) return "is-scheduled";
  if (s.includes("fail") || s.includes("error")) return "is-failed";
  return "";
}

export default function PodcastList({ episodes = [] }) {
  return (
    <section className="sc-podlist">
      <div className="sc-podlist-head">
        <div>
          <span className="sc-kicker">Podcast Section</span>
          <h2 className="sc-podlist-title">
            Episodes generated through the scholar
          </h2>
        </div>
        <span className="sc-count">
          {episodes.length > 0 ? `${episodes.length} episodes` : "No data to show"}
        </span>
      </div>

      {episodes.length > 0 ? (
        episodes.map((episode) => (
          <article key={episode.title} className="sc-card sc-pod">
            <div className="cov" aria-hidden>
              <FaMicrophone size={24} />
              <span className="play">
                <FaPlay size={12} />
              </span>
            </div>
            <div className="body">
              <div className="sc-pod-topline">
                <div>
                  {episode.type ? (
                    <span className="kicker">{episode.type}</span>
                  ) : null}
                  <h3>{episode.title}</h3>
                  {episode.length ? <p>{episode.length}</p> : null}
                </div>
                {episode.state ? (
                  <span className={`sc-status ${stateClass(episode.state)}`}>
                    {episode.state}
                  </span>
                ) : null}
              </div>
              {episode.summary ? (
                <p className="sc-pod-summary">{episode.summary}</p>
              ) : null}
              {episode.audioUrl ? (
                <a
                  href={episode.audioUrl}
                  className="sc-open"
                  target="_blank"
                  rel="noreferrer"
                >
                  Play audio <FaArrowUpRightFromSquare size={11} aria-hidden />
                </a>
              ) : null}
            </div>
          </article>
        ))
      ) : (
        <div className="sc-empty">
          <div className="ic" aria-hidden>
            <FaMicrophone size={24} />
          </div>
          <h3>No data to show</h3>
          <p>Data will appear here once published.</p>
        </div>
      )}
    </section>
  );
}
