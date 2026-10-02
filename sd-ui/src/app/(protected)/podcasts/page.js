import Link from "next/link";
import { HiOutlineArrowRight, HiOutlineArrowTopRightOnSquare, HiOutlineMicrophone } from "react-icons/hi2";

import EpisodeCard from "@/components/podcasts/EpisodeCard";
import Topbar from "@/components/scholar/Topbar";
import Tile from "@/components/scholar/Tile";
import { getDashboardData } from "@/lib/dashboard";
import { getScholarEpisodes } from "@/lib/podcasts";

export const dynamic = "force-dynamic";

/**
 * Podcasts: the conversations made in a scholar's name.
 *
 * ── What changed, and why ──────────────────────────────────────────────────
 * It was a column of text cards with the browser's own audio control, for
 * what is a media product: a conversation between a scholar from the archive
 * and the scholar reading this, built from what both have written. It now
 * looks like one, in the Studio's parts: four numbers, then each episode with
 * a cover, a player and the voice meter, beside how these are made and what
 * to do when one is wrong.
 *
 * ── The order is deliberate ────────────────────────────────────────────────
 * What has not been released comes first, because it is the only part a
 * scholar can still do anything about; then what is being made; then what is
 * out. The second list is what the curated record already held under
 * `links_and_media.podcasts`: a catalogue, not something to decide about.
 */

const SECTIONS = [
  { state: "pending", title: "Not yet released", note: "Read these before they go out. This is when a correction is easiest." },
  { state: "making", title: "Being made", note: "Still being written and voiced. They will move up when they are ready to read." },
  { state: "live", title: "Released", note: "Out for listeners." },
  { state: "stopped", title: "Stopped", note: "Withdrawn or failed in the editorial system. Nobody can hear these." },
];

/* Said as it is: a turn is meant to stand on a cited passage, and the page
   exists because some do not, so the second step promises the flag, not the source. */
const STEPS = [
  ["Paired", "Archivyn pairs your work with another scholar's, often one from the archive, on a theme you share."],
  ["Written from both records", "Each turn is meant to stand on a passage one of you wrote. You see which, and any turn of yours that cites nothing is flagged."],
  ["Shown to you first", "It appears here before anyone can hear it. The editors decide when it goes out."],
];

export default async function PodcastsPage() {
  const [dashboard, episodes] = await Promise.all([getDashboardData(), getScholarEpisodes()]);

  const profile = dashboard?.profile || {};
  const institution =
    (dashboard?.profileDetails || []).find((detail) => detail.label === "Institution")?.value ||
    (Array.isArray(profile.tags) ? profile.tags[1] : "") ||
    "";
  const me = { initials: profile.initials || "SC", name: profile.name || "Scholar", institution };

  const all = episodes || [];
  const by = (state) => all.filter((e) => e.state === state);
  const recordings = dashboard?.podcastEpisodes || [];
  const mine = all.reduce((n, e) => n + (e.voice?.myTurns || 0), 0);
  const bare = all.reduce((n, e) => n + (e.voice?.myTurnsWithoutEvidence || 0), 0);

  return (
    <div className="sc-shell">
      <Topbar activeHref="/podcasts" me={me} />
      <div className="dash pods">
        <header className="dash-head">
          <div>
            <p className="dash-date">Podcasts</p>
            <h1 className="dash-greet">Conversations in your name</h1>
            <p className="pods-intro">
              A scholar from the archive and you, in conversation, built from what you have both written.
              Each one appears here before anyone can hear it.
            </p>
          </div>
        </header>

        {all.length ? (
          <section className="dash-kpis pods-kpis" aria-label="At a glance">
            <Tile label="Not yet released" value={by("pending").length} sub={by("pending").length ? "waiting for your read" : "nothing waiting"} href="#pods-pending" className={by("pending").length ? "is-attention" : ""} />
            <Tile label="Released" value={by("live").length} sub="out for listeners" href="#pods-live" />
            <Tile label="Being made" value={by("making").length} sub="not ready to read yet" href="#pods-making" />
            <Tile label="Spoken as you" value={mine} unit=" turns" sub={bare ? `${bare} cite nothing of yours` : "every one sourced"} href="#pods-pending" className={bare ? "is-attention" : ""} />
          </section>
        ) : null}

        <div className="dash-grid">
          <div className="dash-col-main">
            {all.length ? (
              SECTIONS.filter((s) => by(s.state).length).map((s) => (
                <section key={s.state} className="pods-sect" id={`pods-${s.state}`} aria-labelledby={`pods-${s.state}-title`}>
                  <div className="pods-sect__head">
                    <div className="dash-card__title">
                      <h2 id={`pods-${s.state}-title`} className="dash-h2">{s.title}</h2>
                      <span className={s.state === "pending" ? "dash-count" : "dash-count is-quiet"}>{by(s.state).length}</span>
                    </div>
                    <span className="dash-muted">{s.note}</span>
                  </div>
                  <div className="pods-list">
                    {by(s.state).map((ep) => <EpisodeCard key={ep.id} ep={ep} />)}
                  </div>
                </section>
              ))
            ) : (
              <section className="st-card dash-card pods-empty" aria-labelledby="pods-empty-title">
                <span className="pods-empty__icon" aria-hidden><HiOutlineMicrophone size={26} /></span>
                <h2 id="pods-empty-title" className="dash-h2">No conversation has been made in your name yet</h2>
                <p className="dash-muted">
                  When Archivyn pairs your work with a scholar from the archive, the conversation appears here first:
                  every turn spoken as you, and the passages each one was built from, before anyone can hear it.
                  Conversations are built from your record, so it is worth making sure the record is right.
                </p>
                <div className="dash-links">
                  <Link href="/profile" className="dash-btn">Check your record <HiOutlineArrowRight size={14} aria-hidden /></Link>
                </div>
              </section>
            )}
          </div>

          <aside className="dash-col-side">
            <section className="st-card dash-card dash-side-card" aria-labelledby="pods-how-title">
              <h2 id="pods-how-title" className="dash-h3">How a conversation is made</h2>
              <ol className="pods-steps">
                {STEPS.map(([title, text], i) => (
                  <li key={title}><em>{i + 1}</em><div><b>{title}</b><span>{text}</span></div></li>
                ))}
              </ol>
            </section>

            <section className="st-card dash-card dash-side-card" aria-labelledby="pods-wrong-title">
              <h2 id="pods-wrong-title" className="dash-h3">If something is wrong</h2>
              <p className="dash-muted">
                Changing, approving or withdrawing an episode happens with the editors who made it, not here.
                If a turn misrepresents your work, tell them before it is released, while it is still easy to stop.
              </p>
            </section>

            {recordings.length ? (
              <section className="st-card dash-card dash-side-card" aria-labelledby="pods-rec-title">
                <div className="dash-card__head">
                  <h2 id="pods-rec-title" className="dash-h3">Also on your record</h2>
                  <span className="dash-faint">{recordings.length}</span>
                </div>
                <ul className="prof-list">
                  {recordings.map((r, i) => (
                    <li key={`${r.title}-${i}`}>
                      {r.audioUrl ? (
                        <a href={r.audioUrl} target="_blank" rel="noreferrer">{r.title}<HiOutlineArrowTopRightOnSquare size={12} aria-hidden /></a>
                      ) : (
                        <span className="pods-rec__title">{r.title}</span>
                      )}
                      <span className="prof-list__meta">{[r.type, r.length, r.state].filter(Boolean).join(" · ")}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  );
}
