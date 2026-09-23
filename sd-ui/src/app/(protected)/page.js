import Topbar from "@/components/scholar/Topbar";
import StudioHome from "@/components/scholar/StudioHome";
import { getDraftJobsServer, getDraftSourcesServer } from "@/lib/drafting-server";
import { getEditorialStories } from "@/lib/editorial";
import { getScholarProfile } from "@/lib/profile";
import { getScholarEpisodes } from "@/lib/podcasts";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [profileData, sources, jobsResult, storiesResult, episodes] = await Promise.all([
    getScholarProfile(),
    getDraftSourcesServer(),
    getDraftJobsServer(10),
    getEditorialStories("all"),
    getScholarEpisodes(20),
  ]);

  const profile = profileData?.profile || {};
  const me = {
    initials: profile.initials || "SC",
    name: profile.name || "Scholar",
    institution: profile.institution || "",
  };

  return (
    <div className="sc-shell">
      <Topbar activeHref="/" me={me} />
      <StudioHome
        me={me}
        sources={sources}
        jobs={jobsResult?.jobs || []}
        stories={storiesResult?.stories || []}
        episodes={episodes}
      />
    </div>
  );
}
