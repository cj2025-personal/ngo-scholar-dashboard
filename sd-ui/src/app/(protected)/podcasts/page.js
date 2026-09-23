import Topbar from "@/components/scholar/Topbar";
import ConversationList from "@/components/scholar/ConversationList";
import PodcastList from "@/components/dashboard/PodcastList";
import { getDashboardData } from "@/lib/dashboard";
import { getScholarEpisodes } from "@/lib/podcasts";

export const dynamic = "force-dynamic";

/**
 * Podcasts: the conversations a scholar is in, then anything else on their
 * record.
 *
 * Two lists, because they are two different things and were previously one.
 * The generated dialogues are the product: a legacy scholar and a
 * contemporary one, paired by the admin portal's cron, grounded in quotes
 * from both. The second list is what the curated record already held under
 * `links_and_media.podcasts` — mirrored episodes and outside recordings — and
 * it is a catalogue, not something to decide about.
 *
 * The order is deliberate. What has not been released yet comes first,
 * because it is the only part a scholar can still do anything about.
 */
export default async function PodcastsPage() {
  const [dashboard, episodes] = await Promise.all([getDashboardData(), getScholarEpisodes()]);

  const profile = dashboard?.profile || {};
  const institution =
    (dashboard?.profileDetails || []).find((detail) => detail.label === "Institution")?.value ||
    (Array.isArray(profile.tags) ? profile.tags[1] : "") ||
    "";
  const me = {
    initials: profile.initials || "SC",
    name: profile.name || "Scholar",
    institution,
  };

  const pending = episodes.filter((e) => e.state === "pending");
  const live = episodes.filter((e) => e.state === "live");
  const making = episodes.filter((e) => e.state === "making");
  const other = dashboard?.podcastEpisodes || [];

  return (
    <div className="sc-shell">
      <Topbar activeHref="/podcasts" me={me} />
      <div className="sc-page">
        <header className="sc-page-head">
          <span className="sc-kicker">Podcasts</span>
          <h1>Conversations with your work in them</h1>
          <p>
            Archivyn pairs a scholar from the archive with a scholar working now and
            builds a conversation from what both of them have written. Where you are the
            contemporary scholar, the episode appears here — before anyone can hear it.
          </p>
        </header>

        {pending.length ? (
          <section className="pod-sect">
            <div className="pod-sect__head">
              <h2 className="st-h2">Not yet released</h2>
              <span className="st-todo-detail">{pending.length} episode{pending.length === 1 ? "" : "s"}</span>
            </div>
            <ConversationList episodes={pending} />
          </section>
        ) : null}

        {making.length ? (
          <section className="pod-sect">
            <div className="pod-sect__head">
              <h2 className="st-h2">Being made</h2>
              <span className="st-todo-detail">{making.length}</span>
            </div>
            <ConversationList episodes={making} />
          </section>
        ) : null}

        <section className="pod-sect">
          <div className="pod-sect__head">
            <h2 className="st-h2">Published</h2>
            {live.length ? <span className="st-todo-detail">{live.length} episode{live.length === 1 ? "" : "s"}</span> : null}
          </div>
          <ConversationList
            episodes={live}
            emptyNote={
              pending.length || making.length
                ? "Nothing of yours has been released yet. The episodes above are still with the editors."
                : "When a conversation is generated with your work in it, it appears here before anyone can hear it."
            }
          />
        </section>

        {other.length ? (
          <section className="pod-sect">
            <div className="pod-sect__head">
              <h2 className="st-h2">Also on your record</h2>
              <span className="st-todo-detail">Recordings and links held on your profile</span>
            </div>
            <PodcastList episodes={other} />
          </section>
        ) : null}
      </div>
    </div>
  );
}
