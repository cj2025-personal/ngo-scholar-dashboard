import Link from "next/link";
import { HiOutlineArrowTopRightOnSquare, HiOutlineMicrophone } from "react-icons/hi2";

import EpisodeCard, { ReportButton } from "@/components/podcasts/EpisodeCard";
import TranscriptBody from "@/components/podcasts/TranscriptBody";
import TranscriptDrawer from "@/components/podcasts/TranscriptDrawer";
import Topbar from "@/components/scholar/Topbar";
import { getDashboardData } from "@/lib/dashboard";
import { getScholarEpisode, getScholarEpisodes, runtime } from "@/lib/podcasts";

export const dynamic = "force-dynamic";

/* An episode id as the API issues them; anything else in ?episode= is not looked up. */
const EPISODE_ID = /^[a-f0-9]{24}$/i;
const day = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * Podcasts: the conversations released in a scholar's name.
 *
 * ── Released only (decided 2026-11-16) ─────────────────────────────────────
 * Episodes are made by the company: the pairing, the script, the voices and
 * the decision to release are the editors'. A scholar has no part in an
 * episode before it is out, so they see it once it is (sd-api
 * podcasts.service RELEASED): nothing being made, in review or stopped.
 *
 * ── How the page is laid out ───────────────────────────────────────────────
 * From research on creator dashboards (YouTube Studio, Apple Podcasts
 * Connect), likeness made on someone's behalf (YouTube's likeness detection,
 * SAG-AFTRA's consent terms, Partnership on AI) and empty-state and player
 * guidance (NN/g, Carbon, GOV.UK, W3C WAI):
 * - One column of rows. Most scholars have none to three episodes; the four
 *   tiles and a sidebar of prose said more about the page than about them.
 *   How a conversation is made is a fold under the lead; "if something is
 *   wrong" is a button on each episode, where the problem is.
 * - Voices a model made are labelled where they play (EpisodePlayer).
 * - Nothing yet: what will come here, the three steps it takes, and the one
 *   thing worth doing meanwhile, since a conversation is built from the
 *   scholar's record.
 * - "Also on your record" is what the curated record holds under
 *   `links_and_media.podcasts`. A released episode is mirrored there too, so
 *   an entry that is one of the episodes above is not listed twice.
 *
 * ── The transcript opens over the list ─────────────────────────────────────
 * Since 2026-11-16 an episode's transcript is a side panel on this page, not
 * a page of its own (TranscriptDrawer). Its state is the address:
 * /podcasts?episode=<id>, so a transcript can be linked to, a reload keeps
 * it open, and the back button closes it. /podcasts/<id> redirects here.
 */

/* Said as it is: a turn is meant to stand on a cited passage, and some do
   not, so the second step promises the flag, not the source. */
const STEPS = [
  ["Paired", "Proj Arch pairs your work with another scholar's, often one from the archive, on a theme you share."],
  ["Written from both records", "Each turn is meant to stand on a passage one of you wrote. Any turn of yours that cites nothing is flagged."],
  ["Released", "The editors decide when it goes out. Once it does, it is here with its transcript and the passages behind each turn."],
];

function Recordings({ recordings }) {
  if (!recordings.length) return null;
  return (
    <section className="pods-sect" aria-labelledby="pods-rec-title">
      <div className="pods-sect__head">
        <h2 id="pods-rec-title" className="dash-h2">Also on your record</h2>
        <span className="dash-muted">Other recordings listed on your public record.</span>
      </div>
      <ul className="pods-recs">
        {recordings.map((r, i) => (
          <li key={`${r.title}-${i}`}>
            {r.audioUrl ? (
              <a href={r.audioUrl} target="_blank" rel="noreferrer">
                {/* The record gives a link but no title: said as such, not left as an empty link. */}
                {r.title || "Untitled recording"}
                <HiOutlineArrowTopRightOnSquare size={12} aria-hidden />
              </a>
            ) : (
              <span className="pods-rec__title">{r.title}</span>
            )}
            <span className="prof-list__meta">{[r.type, r.length].filter(Boolean).join(" · ")}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function PodcastsPage({ searchParams }) {
  const asked = (await searchParams)?.episode;
  const openId = typeof asked === "string" && EPISODE_ID.test(asked) ? asked : null;
  const [dashboard, episodes, open] = await Promise.all([getDashboardData(), getScholarEpisodes(), openId ? getScholarEpisode(openId) : null]);

  const profile = dashboard?.profile || {};
  const institution =
    (dashboard?.profileDetails || []).find((detail) => detail.label === "Institution")?.value ||
    (Array.isArray(profile.tags) ? profile.tags[1] : "") ||
    "";
  const me = { initials: profile.initials || "SC", name: profile.name || "Scholar", institution };
  /* Where "Something's wrong?" writes to. Read at request time, so a deployment sets it without a rebuild. */
  const editorsEmail = process.env.EDITORS_EMAIL || null;

  const all = episodes || [];
  const listed = new Set(all.map((e) => e.recordId).filter(Boolean));
  const recordings = (dashboard?.podcastEpisodes || []).filter((r) => !(r.podcastId && listed.has(r.podcastId)));

  return (
    <div className="sc-shell">
      <Topbar activeHref="/podcasts" me={me} />
      <div className="dash pods">
        <header className="dash-head">
          <div>
            <p className="dash-date">Podcasts</p>
            <h1 className="dash-greet">Conversations in your name</h1>
            <p className="pods-intro">Released conversations built from your work and another scholar&rsquo;s.</p>
            {all.length ? (
              <details className="pods-how">
                <summary>How a conversation is made</summary>
                <ol className="pods-steps">
                  {STEPS.map(([title, text], i) => (
                    <li key={title}><em>{i + 1}</em><div><b>{title}</b><span>{text}</span></div></li>
                  ))}
                </ol>
              </details>
            ) : null}
          </div>
        </header>

        <div className="pods-main">
          {asked && !open ? (
            /* A link to a transcript that is not (or no longer) one of theirs and released: said, not silently dropped. */
            <p className="pods-notice" role="status">That conversation isn&rsquo;t available. It may have been withdrawn, or the link is not for one of yours.</p>
          ) : null}
          {all.length ? (
            <section className="st-card dash-card pods-list" aria-label="Your conversations">
              {all.map((ep) => <EpisodeCard key={ep.id} ep={ep} editorsEmail={editorsEmail} />)}
            </section>
          ) : (
            <section className="st-card dash-card es" aria-labelledby="pods-empty-title">
              <div className="es-intro">
                <span className="es-icon" aria-hidden>
                  <HiOutlineMicrophone size={24} />
                </span>
                <div>
                  <h2 id="pods-empty-title" className="dash-h2">Nothing released in your name yet</h2>
                  <p className="es-lead">When Proj Arch releases a conversation built from your work, it will be here to hear and read.</p>
                </div>
              </div>
              <ol className="es-steps">
                {STEPS.map(([title, text], i) => (
                  <li key={title}>
                    <span className="es-n" aria-hidden>{i + 1}</span>
                    <div>
                      <h3 className="es-h3">{title}</h3>
                      <p>{text}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="es-foot">
                <Link href="/profile" className="dash-btn is-primary es-action">Check your record</Link>
                <span>Every conversation is built from it.</span>
              </div>
            </section>
          )}
          <Recordings recordings={recordings} />
        </div>
      </div>

      {open ? (
        <TranscriptDrawer
          key={open.id}
          episodeId={open.id}
          title={open.title}
          meta={[
            open.with?.name ? `With ${open.with.name}${open.with.kind === "legend" ? " · from the archive" : open.with.field ? ` · ${open.with.field}` : ""}` : null,
            open.publishedAt ? `Released ${day(open.publishedAt)}` : null,
            runtime(open.audio?.durationSeconds),
          ].filter(Boolean).join(" · ")}
          footer={
            <>
              <p>If a turn misrepresents your work, tell the editors which one. They can correct the episode or withdraw it.</p>
              <ReportButton editorsEmail={editorsEmail} ep={open} className="dash-btn" />
            </>
          }
        >
          <TranscriptBody episode={open} />
        </TranscriptDrawer>
      ) : null}
    </div>
  );
}
