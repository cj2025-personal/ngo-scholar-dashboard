import Topbar from "@/components/scholar/Topbar";
import PodcastList from "@/components/dashboard/PodcastList";
import { getDashboardData } from "@/lib/dashboard";

export default async function PodcastsPage() {
  const dashboard = await getDashboardData();
  const profile = dashboard?.profile || {};
  const institution =
    (dashboard?.profileDetails || []).find((detail) => detail.label === "Institution")
      ?.value ||
    (Array.isArray(profile.tags) ? profile.tags[1] : "") ||
    "";
  const me = {
    initials: profile.initials || "SC",
    name: profile.name || "Scholar",
    institution,
  };

  return (
    <div className="sc-shell">
      <Topbar activeHref="/podcasts" me={me} />
      <div className="sc-page">
        <header className="sc-page-head">
          <span className="sc-kicker">Podcast Hub</span>
          <h1>Scholar-generated audio and conversations</h1>
          <p>
            This section surfaces scholar podcast episodes and linked media
            records for listening and review.
          </p>
        </header>

        <PodcastList episodes={dashboard?.podcastEpisodes || []} />
      </div>
    </div>
  );
}
